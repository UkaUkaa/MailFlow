"""Generic IMAP (reading, flags, moves, drafts) + SMTP (submission) adapter.

Built on the standard library's blocking ``imaplib`` / ``smtplib``; every network step runs in
a worker thread. One adapter instance owns at most one IMAP connection, opened lazily through
:class:`~app.integrations.email_providers.imap.transport.MailConnector` (SSRF guard, validated
IP, verified TLS) and closed by ``aclose``. Calls are serialized, so the sync runner's
concurrent ``get_message`` calls share the connection safely.

IMAP has no mailbox-wide change feed and no stable message id: a message is identified by
folder + UIDVALIDITY + UID, and the sync cursor carries per-folder state (see ``mailbox.py``).
"""

from __future__ import annotations

import asyncio
import imaplib
import re
import smtplib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, TypeVar

from app.integrations.email_providers.contracts.errors import (
    ProviderAuthError,
    ProviderCursorExpired,
    ProviderError,
    ProviderNotFound,
    ProviderUnavailable,
    ProviderUnsupported,
)
from app.integrations.email_providers.contracts.models import (
    FolderRole,
    MessagePage,
    OutgoingMessage,
    ProviderCapabilities,
    ProviderDraft,
    ProviderFolder,
    ProviderMessage,
    Relocation,
    SentMessage,
    ServerCredentials,
    SyncChanges,
    ThreadAction,
)
from app.integrations.email_providers.imap import mailbox as mb
from app.integrations.email_providers.imap import mime
from app.integrations.email_providers.imap.transport import (
    IMAP_PORTS,
    SMTP_PORTS,
    MailConnector,
    close_imap,
    close_smtp,
)

# What the adapter can do when the mailbox has the folders for it. A mailbox without an
# Archive, Junk or Drafts folder gets ``ProviderUnsupported`` for those operations, and the
# accounts API reports the flag as false for that mailbox.
IMAP_CAPABILITIES = ProviderCapabilities(
    threads=False,
    labels=False,
    server_search=False,
    drafts=True,
    spam=True,
    archive=True,
    incremental_sync=True,
    oauth=False,
)

MAX_MESSAGE_BYTES = 40 * 1024 * 1024  # larger messages are read truncated
MAX_CHANGES_PER_SYNC = 200  # new + changed messages reported by one synchronize call

_FLAG_ACTIONS: dict[ThreadAction, tuple[str, str]] = {
    ThreadAction.MARK_READ: ("+FLAGS.SILENT", "(\\Seen)"),
    ThreadAction.MARK_UNREAD: ("-FLAGS.SILENT", "(\\Seen)"),
    ThreadAction.STAR: ("+FLAGS.SILENT", "(\\Flagged)"),
    ThreadAction.UNSTAR: ("-FLAGS.SILENT", "(\\Flagged)"),
}
_MOVE_TARGETS: dict[ThreadAction, FolderRole] = {
    ThreadAction.ARCHIVE: FolderRole.ARCHIVE,
    ThreadAction.UNARCHIVE: FolderRole.INBOX,
    ThreadAction.TRASH: FolderRole.TRASH,
    ThreadAction.RESTORE: FolderRole.INBOX,
    ThreadAction.SPAM: FolderRole.SPAM,
    ThreadAction.NOT_SPAM: FolderRole.INBOX,
}
_UID = re.compile(rb"\bUID (\d+)")
_FLAGS = re.compile(rb"\bFLAGS \(([^)]*)\)")
_MODSEQ = re.compile(rb"\bMODSEQ \((\d+)\)")
_INTERNALDATE = re.compile(rb'\bINTERNALDATE "([^"]+)"')
_SIZE = re.compile(rb"\bRFC822\.SIZE (\d+)")
_STATUS = re.compile(rb"\b(MESSAGES|UIDNEXT|UIDVALIDITY|HIGHESTMODSEQ) (\d+)")
_UID_PAIR = re.compile(rb"(\d+) (\S+) (\S+)")

T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class _Status:
    uidvalidity: int
    uidnext: int
    messages: int
    modseq: int


@dataclass(frozen=True, slots=True)
class _Fetched:
    uid: int
    flags: tuple[str, ...]
    modseq: int
    meta: bytes
    literal: bytes | None


def _ok(typ: str, what: str) -> None:
    if typ != "OK":
        raise ProviderUnavailable(f"imap {what} refused")


def _records(data: list[Any]) -> list[_Fetched]:
    """Group ``FETCH`` response fragments into one record per message."""
    grouped: list[tuple[bytes, bytes | None]] = []
    open_record = False
    for item in data:
        if isinstance(item, tuple) and len(item) == 2 and isinstance(item[0], bytes):
            literal = item[1] if isinstance(item[1], bytes) else None
            grouped.append((item[0], literal))
            open_record = True
        elif isinstance(item, bytes):
            if open_record and not re.match(rb"^\d+ \(", item):
                meta, literal = grouped[-1]
                grouped[-1] = (meta + b" " + item, literal)
            else:
                grouped.append((item, None))
            open_record = False
    result = []
    for meta, literal in grouped:
        uid = _UID.search(meta)
        if uid is None:
            continue  # unsolicited update for another message
        flags = _FLAGS.search(meta)
        modseq = _MODSEQ.search(meta)
        result.append(
            _Fetched(
                uid=int(uid[1]),
                flags=tuple(flags[1].decode("ascii", "replace").split()) if flags else (),
                modseq=int(modseq[1]) if modseq else 0,
                meta=meta,
                literal=literal,
            )
        )
    return result


def _internal_date(meta: bytes) -> datetime:
    match = _INTERNALDATE.search(meta)
    if match:
        try:
            parsed = datetime.strptime(match[1].decode("ascii").strip(), "%d-%b-%Y %H:%M:%S %z")
            return parsed.astimezone(UTC)
        except ValueError:
            pass
    return datetime.now(UTC)


def _numbers(data: list[Any]) -> list[int]:
    result: list[int] = []
    for item in data:
        if isinstance(item, bytes):
            result.extend(int(n) for n in item.split() if n.isdigit())
    return result


class ImapProvider:
    def __init__(
        self,
        connector: MailConnector,
        credentials: ServerCredentials,
        *,
        max_changes: int = MAX_CHANGES_PER_SYNC,
    ) -> None:
        self._connector = connector
        self._credentials = credentials
        self._max_changes = max_changes
        self._lock = asyncio.Lock()
        self._conn: imaplib.IMAP4 | None = None
        self._capabilities: frozenset[str] = frozenset()
        self._selected: tuple[str, bool, int] | None = None  # name, read-only, UIDVALIDITY
        self._folders: list[mb.Folder] | None = None

    @property
    def capabilities(self) -> ProviderCapabilities:
        return IMAP_CAPABILITIES

    # -- connection ------------------------------------------------------------------------

    async def _connect(self) -> imaplib.IMAP4:
        # The guard runs on every connect: a reconnect resolves and validates again.
        target = await self._connector.resolve(self._credentials.imap, IMAP_PORTS)
        conn = await asyncio.to_thread(self._connector.open_imap, target, self._credentials)
        self._conn = conn
        self._capabilities = frozenset(c.upper() for c in conn.capabilities)
        self._selected = None
        return conn

    async def _drop(self) -> None:
        conn, self._conn, self._selected = self._conn, None, None
        if conn is not None:
            await asyncio.to_thread(close_imap, conn)

    async def aclose(self) -> None:
        async with self._lock:
            await self._drop()

    async def _run(self, work: Callable[[imaplib.IMAP4], T], *, retry: bool = True) -> T:
        """Run blocking ``work`` on the connection. A dropped connection is re-established
        once (through the guard) for work that is safe to repeat."""
        async with self._lock:
            for attempt in (1, 2):
                conn = self._conn or await self._connect()
                try:
                    return await asyncio.to_thread(work, conn)
                except ProviderError:
                    raise
                except (imaplib.IMAP4.abort, OSError, EOFError) as exc:
                    await self._drop()
                    if attempt == 2 or not retry:
                        raise ProviderUnavailable("imap connection lost") from exc
                except imaplib.IMAP4.error as exc:
                    raise ProviderUnavailable("imap command failed") from exc
            raise ProviderUnavailable("imap connection lost")  # pragma: no cover

    # -- blocking helpers (run inside ``_run``) -------------------------------------------

    def _list(self, conn: imaplib.IMAP4) -> list[mb.Folder]:
        if self._folders is None:
            typ, data = conn.list('""', '"*"')
            _ok(typ, "list")
            self._folders = mb.parse_list(list(data))
        return self._folders

    def _folder(self, conn: imaplib.IMAP4, key: str) -> mb.Folder:
        for folder in self._list(conn):
            if folder.key == key:
                return folder
        raise ProviderNotFound("folder no longer exists")

    def _role_folder(self, conn: imaplib.IMAP4, role: FolderRole) -> mb.Folder | None:
        return next((f for f in self._list(conn) if f.role is role), None)

    def _select(self, conn: imaplib.IMAP4, folder: mb.Folder, *, readonly: bool) -> int:
        if self._selected is not None and self._selected[:2] == (folder.name, readonly):
            return self._selected[2]
        self._selected = None
        typ, _ = conn.select(mb.quote(folder.name), readonly=readonly)
        if typ != "OK":
            raise ProviderNotFound("folder cannot be opened")
        _, validity = conn.response("UIDVALIDITY")
        if not validity or validity[0] is None:
            raise ProviderUnavailable("imap server sent no UIDVALIDITY")
        self._selected = (folder.name, readonly, int(validity[0]))
        return self._selected[2]

    def _open_ref(self, conn: imaplib.IMAP4, ref: mb.MessageRef, *, readonly: bool) -> mb.Folder:
        folder = self._folder(conn, ref.key)
        if self._select(conn, folder, readonly=readonly) != ref.uidvalidity:
            raise ProviderNotFound("message id is from an earlier UIDVALIDITY")
        return folder

    def _status(self, conn: imaplib.IMAP4, folder: mb.Folder) -> _Status | None:
        items = "UIDVALIDITY UIDNEXT MESSAGES"
        if "CONDSTORE" in self._capabilities:
            items += " HIGHESTMODSEQ"
        typ, data = conn.status(mb.quote(folder.name), f"({items})")
        if typ != "OK":
            return None  # deleted or not selectable since LIST
        joined = b" ".join(
            part
            for item in data
            for part in (item if isinstance(item, tuple) else (item,))
            if isinstance(part, bytes)
        )
        values = {m[1].decode(): int(m[2]) for m in _STATUS.finditer(joined[joined.rfind(b"(") :])}
        if "UIDVALIDITY" not in values or "UIDNEXT" not in values:
            return None
        return _Status(
            uidvalidity=values["UIDVALIDITY"],
            uidnext=values["UIDNEXT"],
            messages=values.get("MESSAGES", 0),
            modseq=values.get("HIGHESTMODSEQ", 0),
        )

    @staticmethod
    def _search(conn: imaplib.IMAP4, *criteria: str) -> list[int]:
        typ, data = conn.uid("SEARCH", *criteria)
        _ok(typ, "search")
        return _numbers(list(data))

    @staticmethod
    def _fetch(conn: imaplib.IMAP4, uids: str, items: str, *modifiers: str) -> list[_Fetched]:
        typ, data = conn.uid("FETCH", uids, items, *modifiers)
        _ok(typ, "fetch")
        return _records(list(data))

    def _flag_window(self, conn: imaplib.IMAP4, known: set[int]) -> dict[int, int]:
        window = sorted(known)[-mb.FLAG_WINDOW :]
        if not window:
            return {}
        wanted = set(window)
        fetched = self._fetch(conn, f"{window[0]}:{window[-1]}", "(UID FLAGS)")
        return {r.uid: mb.flag_bits(r.flags) for r in fetched if r.uid in wanted}

    def _raw(self, conn: imaplib.IMAP4, ref: mb.MessageRef) -> tuple[mb.Folder, _Fetched]:
        folder = self._open_ref(conn, ref, readonly=True)
        # BODY.PEEK: reading a message for synchronization must never mark it as read.
        items = f"(UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[]<0.{MAX_MESSAGE_BYTES}>)"
        for record in self._fetch(conn, str(ref.uid), items):
            if record.uid == ref.uid and record.literal is not None:
                return folder, record
        raise ProviderNotFound("message no longer exists")

    # -- reading ---------------------------------------------------------------------------

    def _message(self, conn: imaplib.IMAP4, provider_message_id: str) -> ProviderMessage:
        ref = mb.decode_id(provider_message_id)
        folder, record = self._raw(conn, ref)
        parsed = mime.parse_message(record.literal or b"")
        flags = {f.lower() for f in record.flags}
        is_draft = folder.role is FolderRole.DRAFTS or "\\draft" in flags
        size = _SIZE.search(record.meta)
        custom = folder.role is FolderRole.CUSTOM
        return ProviderMessage(
            provider_message_id=provider_message_id,
            provider_thread_id=provider_message_id,
            subject=parsed.subject,
            snippet=parsed.snippet,
            sender=parsed.sender,
            to=parsed.to,
            cc=parsed.cc,
            bcc=parsed.bcc,
            reply_to=parsed.reply_to,
            sent_at=mime.effective_date(parsed.date, _internal_date(record.meta)),
            is_read="\\seen" in flags,
            is_starred="\\flagged" in flags,
            is_draft=is_draft,
            roles=frozenset() if custom else frozenset({folder.role}),
            folder_ids=(folder.key,) if custom else (),
            rfc822_message_id=parsed.rfc822_message_id,
            in_reply_to=parsed.in_reply_to,
            references=parsed.references,
            body_html=parsed.body_html,
            body_text=parsed.body_text,
            attachments=parsed.attachments,
            size_estimate=int(size[1]) if size else len(record.literal or b""),
            provider_draft_id=provider_message_id if is_draft else None,
        )

    async def get_message(self, provider_message_id: str) -> ProviderMessage:
        return await self._run(lambda conn: self._message(conn, provider_message_id))

    async def get_thread(self, provider_thread_id: str) -> list[ProviderMessage]:
        # No server-side threads: a conversation is one message.
        return [await self.get_message(provider_thread_id)]

    async def get_attachment(self, provider_message_id: str, part_id: str) -> bytes:
        def work(conn: imaplib.IMAP4) -> bytes:
            _, record = self._raw(conn, mb.decode_id(provider_message_id))
            content = mime.extract_part(record.literal or b"", part_id)
            if content is None:
                raise ProviderNotFound("attachment part missing")
            return content

        return await self._run(work)

    async def list_folders(self) -> list[ProviderFolder]:
        def work(conn: imaplib.IMAP4) -> list[ProviderFolder]:
            self._folders = None  # always fresh for the caller that stores them
            return mb.to_provider_folders(self._list(conn))

        return await self._run(work)

    async def search_messages(
        self, query: str, *, page_token: str | None, page_size: int
    ) -> MessagePage:
        raise ProviderUnsupported("server-side search is not implemented for IMAP")

    def _initial_cursor(self, conn: imaplib.IMAP4, folders: list[mb.Folder]) -> str:
        cursor = mb.Cursor()
        for folder in folders:
            status = self._status(conn, folder)
            if status is None:
                continue
            try:
                self._select(conn, folder, readonly=True)
            except ProviderNotFound:
                continue
            last_uid = max(status.uidnext - 1, 0)
            known = {u for u in self._search(conn, "ALL") if u <= last_uid}
            state = mb.FolderState(status.uidvalidity, last_uid, status.modseq, known)
            if not status.modseq:
                state.flags = self._flag_window(conn, known)
            cursor.folders[folder.key] = state
        return mb.encode_cursor(cursor)

    def _page(self, conn: imaplib.IMAP4, page_token: str | None, page_size: int) -> MessagePage:
        self._folders = None
        folders = self._list(conn)
        cursor: str | None = None
        index, validity, before = 0, 0, None
        if page_token is None:
            # Captured before listing, so nothing that arrives in between is missed.
            cursor = self._initial_cursor(conn, folders)
        else:
            key, validity, before = mb.decode_page_token(page_token)
            index = next((i for i, f in enumerate(folders) if f.key == key), 0)
            if folders and folders[index].key != key:
                validity, before = 0, None  # that folder is gone: go through the list again
        ids: list[str] = []
        next_token: str | None = None
        while index < len(folders) and len(ids) < page_size:
            folder = folders[index]
            try:
                current = self._select(conn, folder, readonly=True)
            except ProviderNotFound:
                index, validity, before = index + 1, 0, None
                continue
            if validity and validity != current:
                before = None  # the folder was rebuilt: list it from the top again
            if before is None:
                uids = self._search(conn, "ALL")
            elif before > 1:
                uids = [u for u in self._search(conn, "UID", f"1:{before - 1}") if u < before]
            else:
                uids = []
            uids.sort(reverse=True)
            take = uids[: page_size - len(ids)]
            ids.extend(mb.encode_id(folder.key, current, uid) for uid in take)
            if len(uids) > len(take):
                next_token = mb.encode_page_token(folder.key, current, take[-1])
                break
            index, validity, before = index + 1, 0, None
            next_token = (
                mb.encode_page_token(folders[index].key, 0, None) if index < len(folders) else None
            )
        return MessagePage(tuple(ids), next_token, cursor)

    async def list_messages(self, *, page_token: str | None, page_size: int) -> MessagePage:
        """Every synchronized folder in turn (Inbox first), newest UID first inside each."""
        size = max(1, page_size)
        return await self._run(lambda conn: self._page(conn, page_token, size))

    # -- incremental synchronization -------------------------------------------------------

    def _changed_since(
        self, conn: imaplib.IMAP4, state: mb.FolderState, skip: set[int], budget: int
    ) -> tuple[list[int], int]:
        """CONDSTORE: messages whose flags changed after ``state.modseq`` (RFC 7162).

        Returns the UIDs to report and the mod-sequence up to which they are complete, so a
        burst larger than the budget continues on the next call. A message that arrived
        while an earlier call was cut short can show up here once more; reporting it twice
        is harmless (ingestion is idempotent), missing a change would not be."""
        fetched = self._fetch(
            conn, f"1:{max(state.last_uid, 1)}", "(UID FLAGS)", f"(CHANGEDSINCE {state.modseq})"
        )
        changed = sorted((r.modseq, r.uid) for r in fetched if r.uid not in skip and r.modseq)
        if len(changed) <= budget:
            return [uid for _, uid in changed], 0
        boundary = changed[max(budget, 1) - 1][0]
        return [uid for modseq, uid in changed if modseq <= boundary], boundary

    def _sync_folder(
        self,
        conn: imaplib.IMAP4,
        folder: mb.Folder,
        status: _Status,
        state: mb.FolderState,
        budget: int,
    ) -> tuple[list[int], list[int], bool]:
        """Bring ``state`` up to date. Returns (upserted UIDs, deleted UIDs, finished)."""
        upserted: list[int] = []
        deleted: list[int] = []
        finished = True
        new: list[int] = []
        if status.uidnext - 1 > state.last_uid:
            self._select(conn, folder, readonly=True)
            found = sorted(
                u
                for u in self._search(conn, "UID", f"{state.last_uid + 1}:*")
                if u > state.last_uid
            )
            new = found[:budget]
            if len(found) > len(new):
                finished = False
                state.last_uid = new[-1] if new else state.last_uid
            else:
                state.last_uid = max(status.uidnext - 1, state.last_uid)
            state.known.update(new)
            upserted.extend(new)
        if not finished:
            return upserted, deleted, False
        if status.messages != len(state.known):
            # Something was expunged (here or by another client): compare the UID sets.
            self._select(conn, folder, readonly=True)
            current = {u for u in self._search(conn, "ALL") if u <= state.last_uid}
            deleted.extend(sorted(state.known - current))
            state.known = current
            state.flags = {u: b for u, b in state.flags.items() if u in current}
            upserted = [u for u in upserted if u in current]
        remaining = budget - len(upserted)
        if status.modseq:
            if state.modseq and status.modseq > state.modseq and state.known:
                self._select(conn, folder, readonly=True)
                changed, boundary = self._changed_since(conn, state, set(new), max(remaining, 1))
                upserted.extend(u for u in changed if u in state.known)
                if boundary:
                    state.modseq = boundary
                    return upserted, deleted, False
            state.modseq = status.modseq
            state.flags = {}
        elif state.known:
            # No CONDSTORE: compare the flags of the most recent messages with last time.
            self._select(conn, folder, readonly=True)
            latest = self._flag_window(conn, state.known)
            seen_new = set(new)
            upserted.extend(
                uid
                for uid, bits in latest.items()
                if uid not in seen_new and uid in state.flags and state.flags[uid] != bits
            )
            state.flags = latest
        return upserted, deleted, True

    def _synchronize(self, conn: imaplib.IMAP4, raw_cursor: str) -> SyncChanges:
        cursor = mb.decode_cursor(raw_cursor)
        self._folders = None
        folders = self._list(conn)
        present = {f.key for f in folders}
        if any(key not in present for key in cursor.folders):
            # A tracked folder disappeared; its messages cannot be enumerated any more.
            raise ProviderCursorExpired("imap folder removed")
        upserted: dict[str, None] = {}
        deleted: dict[str, None] = {}
        budget = self._max_changes
        count = len(folders)
        start = cursor.resume % count if count else 0
        cursor.resume = 0
        for offset in range(count):
            position = (start + offset) % count
            folder = folders[position]
            if budget <= 0:
                cursor.resume = position
                break
            status = self._status(conn, folder)
            if status is None:
                continue
            state = cursor.folders.get(folder.key)
            if state is None:
                state = cursor.folders[folder.key] = mb.FolderState(status.uidvalidity)
            elif state.uidvalidity != status.uidvalidity:
                # RFC 3501 2.3.1.1: every UID we hold for this folder is now meaningless.
                raise ProviderCursorExpired("imap UIDVALIDITY changed")
            try:
                up, gone, finished = self._sync_folder(conn, folder, status, state, budget)
            except ProviderNotFound:
                continue
            for uid in gone:
                deleted[mb.encode_id(folder.key, state.uidvalidity, uid)] = None
            for uid in up:
                upserted[mb.encode_id(folder.key, state.uidvalidity, uid)] = None
            budget -= len(up)
            if not finished:
                cursor.resume = position
                break
        for message_id in deleted:
            upserted.pop(message_id, None)
        return SyncChanges(tuple(upserted), tuple(deleted), mb.encode_cursor(cursor))

    async def synchronize(self, cursor: str) -> SyncChanges:
        """New UIDs, flag changes and expunges per folder, at most ``max_changes`` upserts
        per call; the returned cursor resumes where this call stopped."""
        return await self._run(lambda conn: self._synchronize(conn, cursor))

    # -- modifying -------------------------------------------------------------------------

    def _require_uid(self, conn: imaplib.IMAP4, uid: int) -> None:
        if uid not in self._search(conn, "UID", str(uid)):
            raise ProviderNotFound("message no longer exists")

    def _expunge(self, conn: imaplib.IMAP4, uid: int) -> None:
        typ, _ = conn.uid("STORE", str(uid), "+FLAGS.SILENT", "(\\Deleted)")
        _ok(typ, "store")
        # UID EXPUNGE (RFC 4315) removes exactly this message; a plain EXPUNGE would also
        # destroy whatever else the user has marked \Deleted in another client.
        typ, _ = conn.uid("EXPUNGE", str(uid))
        _ok(typ, "expunge")

    def _destination_uid(self, conn: imaplib.IMAP4, code: str, uid: int) -> tuple[int, int] | None:
        """(UIDVALIDITY, UID) in the destination from a COPYUID response code, if sent."""
        _, data = conn.response(code)
        for item in data or []:
            match = _UID_PAIR.search(item) if isinstance(item, bytes) else None
            if match and match[2].isdigit() and match[3].isdigit() and int(match[2]) == uid:
                return int(match[1]), int(match[3])
        return None

    def _move(self, conn: imaplib.IMAP4, ref: mb.MessageRef, role: FolderRole) -> str | None:
        """Move one message to the folder with ``role``. Returns its new id when known."""
        target = self._role_folder(conn, role)
        if target is None:
            raise ProviderUnsupported(f"mailbox has no {role.value} folder")
        if target.key == ref.key:
            return None  # already there
        can_move = "MOVE" in self._capabilities
        if not can_move and "UIDPLUS" not in self._capabilities:
            raise ProviderUnsupported("server supports neither MOVE nor UIDPLUS")
        self._open_ref(conn, ref, readonly=False)
        self._require_uid(conn, ref.uid)
        conn.response("COPYUID")  # discard anything left over
        if can_move:
            typ, _ = conn.uid("MOVE", str(ref.uid), mb.quote(target.name))  # RFC 6851
            _ok(typ, "move")
        else:
            typ, _ = conn.uid("COPY", str(ref.uid), mb.quote(target.name))
            _ok(typ, "copy")
        destination = self._destination_uid(conn, "COPYUID", ref.uid)
        if not can_move:
            self._expunge(conn, ref.uid)
        if destination is None:
            return None  # no UIDPLUS answer: the next synchronization finds the message
        return mb.encode_id(target.key, *destination)

    def _modify(
        self, conn: imaplib.IMAP4, provider_message_id: str, action: ThreadAction
    ) -> tuple[Relocation, ...] | None:
        ref = mb.decode_id(provider_message_id)
        if action in _FLAG_ACTIONS:
            self._open_ref(conn, ref, readonly=False)
            self._require_uid(conn, ref.uid)
            typ, _ = conn.uid("STORE", str(ref.uid), *_FLAG_ACTIONS[action])
            _ok(typ, "store")
            return None
        new_id = self._move(conn, ref, _MOVE_TARGETS[action])
        return (Relocation(provider_message_id, new_id),) if new_id else None

    async def modify_message(
        self, provider_message_id: str, action: ThreadAction
    ) -> tuple[Relocation, ...] | None:
        # Not repeated after a lost connection: a move may already have happened.
        return await self._run(
            lambda conn: self._modify(conn, provider_message_id, action),
            retry=action in _FLAG_ACTIONS,
        )

    async def modify_thread(
        self, provider_thread_id: str, action: ThreadAction
    ) -> tuple[Relocation, ...] | None:
        return await self.modify_message(provider_thread_id, action)

    async def delete_message(self, provider_message_id: str) -> None:
        await self.modify_message(provider_message_id, ThreadAction.TRASH)

    # -- sending and drafts ----------------------------------------------------------------

    def _append(
        self, conn: imaplib.IMAP4, role: FolderRole, flags: str, content: bytes, message_id: str
    ) -> str:
        folder = self._role_folder(conn, role)
        if folder is None:
            raise ProviderUnsupported(f"mailbox has no {role.value} folder")
        conn.response("APPENDUID")
        typ, _ = conn.append(mb.quote(folder.name), flags, None, content)
        _ok(typ, "append")
        _, data = conn.response("APPENDUID")
        for item in data or []:
            parts = item.split() if isinstance(item, bytes) else []
            if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
                return mb.encode_id(folder.key, int(parts[0]), int(parts[1]))
        # No UIDPLUS: find the copy by its Message-ID.
        self._selected = None
        validity = self._select(conn, folder, readonly=True)
        found = self._search(conn, "HEADER", "Message-ID", mb.quote(message_id.strip()))
        if not found:
            raise ProviderNotFound("appended message not found")
        return mb.encode_id(folder.key, validity, max(found))

    def _submit(self, target: Any, mime_message: Any, message: OutgoingMessage) -> None:
        """Blocking SMTP submission. Never retried: a failure after DATA is ambiguous."""
        sender = mime.envelope_address(message.sender.email)
        recipients = mime.recipients(message)
        if not recipients:
            raise ProviderError("no recipients")
        content = mime.wire_bytes(mime_message, include_bcc=False)
        smtp = self._connector.open_smtp(target, self._credentials)
        try:
            smtp.sendmail(sender, recipients, content)
        except smtplib.SMTPAuthenticationError as exc:
            raise ProviderAuthError("smtp login rejected") from exc
        except (smtplib.SMTPException, OSError) as exc:
            raise ProviderUnavailable("smtp submission failed") from exc
        finally:
            close_smtp(smtp)

    async def send_message(self, message: OutgoingMessage) -> SentMessage:
        mime_message = mime.build_message(message)
        target = await self._connector.resolve(self._credentials.smtp, SMTP_PORTS)
        await asyncio.to_thread(self._submit, target, mime_message, message)
        # The message is out. Saving the copy is best effort and must not fail the send.
        copy = mime.wire_bytes(mime_message, include_bcc=True)
        message_id = str(mime_message["Message-ID"])
        try:
            sent_id = await self._run(
                lambda conn: self._append(conn, FolderRole.SENT, "(\\Seen)", copy, message_id),
                retry=False,
            )
        except ProviderError:
            sent_id = "unsaved"  # not a readable id: there is no copy to show
        return SentMessage(sent_id, sent_id)

    async def reply_message(self, message: OutgoingMessage) -> SentMessage:
        return await self.send_message(message)

    async def forward_message(self, message: OutgoingMessage) -> SentMessage:
        return await self.send_message(message)

    async def create_draft(self, message: OutgoingMessage) -> ProviderDraft:
        mime_message = mime.build_message(message)
        content = mime.wire_bytes(mime_message, include_bcc=True)
        message_id = str(mime_message["Message-ID"])
        draft_id = await self._run(
            lambda conn: self._append(
                conn, FolderRole.DRAFTS, "(\\Draft \\Seen)", content, message_id
            ),
            retry=False,
        )
        return ProviderDraft(draft_id, draft_id, draft_id)

    def _remove(self, conn: imaplib.IMAP4, provider_message_id: str) -> None:
        ref = mb.decode_id(provider_message_id)
        if "UIDPLUS" not in self._capabilities:
            # Cannot expunge one message safely; put it in the trash instead.
            self._move(conn, ref, FolderRole.TRASH)
            return
        self._open_ref(conn, ref, readonly=False)
        self._require_uid(conn, ref.uid)
        self._expunge(conn, ref.uid)

    async def update_draft(self, provider_draft_id: str, message: OutgoingMessage) -> ProviderDraft:
        # IMAP messages are immutable: store the new version first, then remove the old one,
        # so a failure in between leaves a duplicate rather than losing the draft.
        draft = await self.create_draft(message)
        try:
            await self._run(lambda conn: self._remove(conn, provider_draft_id), retry=False)
        except ProviderNotFound:
            pass
        return draft

    async def delete_draft(self, provider_draft_id: str) -> None:
        await self._run(lambda conn: self._remove(conn, provider_draft_id), retry=False)

    async def send_draft(self, provider_draft_id: str) -> SentMessage:
        raise ProviderUnsupported("sending a stored draft is not implemented for IMAP")
