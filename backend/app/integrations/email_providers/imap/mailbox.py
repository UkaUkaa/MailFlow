"""Folder names, roles, message ids, UID sets and the sync cursor. Pure functions, no I/O."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from dataclasses import dataclass, field

from app.integrations.email_providers.contracts.errors import (
    ProviderCursorExpired,
    ProviderNotFound,
)
from app.integrations.email_providers.contracts.models import FolderRole, ProviderFolder

MAX_INLINE_NAME = 150  # longer folder names are represented by a hash in ids
MAX_FOLDERS = 200
FLAG_WINDOW = 100  # most recent messages per folder whose flags are compared without CONDSTORE

# RFC 6154 SPECIAL-USE attributes. ``\All`` and ``\Flagged`` are virtual views of mail that
# also lives elsewhere, so those folders are not synchronized.
_SPECIAL_USE = {
    "\\sent": FolderRole.SENT,
    "\\drafts": FolderRole.DRAFTS,
    "\\trash": FolderRole.TRASH,
    "\\junk": FolderRole.SPAM,
    "\\archive": FolderRole.ARCHIVE,
}
_SKIPPED = {"\\noselect", "\\nonexistent", "\\all", "\\flagged"}
# Fallback for servers without SPECIAL-USE: common English names, matched on the last path
# component. Other languages are not covered (see docs/LIMITATIONS.md).
_NAMES = {
    FolderRole.SENT: ("sent", "sent items", "sent mail", "sent messages"),
    FolderRole.DRAFTS: ("drafts", "draft"),
    FolderRole.TRASH: ("trash", "deleted items", "deleted messages", "bin"),
    FolderRole.SPAM: ("junk", "spam", "junk e-mail", "junk email", "bulk mail"),
    FolderRole.ARCHIVE: ("archive", "archives"),
}
_ROLE_TITLES = {
    FolderRole.INBOX: "Inbox",
    FolderRole.SENT: "Sent",
    FolderRole.DRAFTS: "Drafts",
    FolderRole.TRASH: "Trash",
    FolderRole.SPAM: "Spam",
    FolderRole.ARCHIVE: "Archive",
}
_ROLE_ORDER = [
    FolderRole.INBOX,
    FolderRole.SENT,
    FolderRole.DRAFTS,
    FolderRole.ARCHIVE,
    FolderRole.CUSTOM,
    FolderRole.SPAM,
    FolderRole.TRASH,
]
_LIST = re.compile(rb'^\((?P<flags>[^)]*)\) (?P<delim>"(?:[^"\\]|\\.)"|NIL) (?P<name>.*)$', re.S)
_ID = re.compile(r"^(?P<key>[nh][A-Za-z0-9_-]+)\.(?P<validity>\d{1,10})\.(?P<uid>\d{1,10})$")


# -- folder names ----------------------------------------------------------------------------


def decode_utf7(name: str) -> str:
    """Modified UTF-7 (RFC 3501 5.1.3) to text. Invalid input is returned unchanged."""
    if "&" not in name:
        return name
    out: list[str] = []
    i = 0
    try:
        while i < len(name):
            if name[i] != "&":
                out.append(name[i])
                i += 1
                continue
            end = name.index("-", i)
            chunk = name[i + 1 : end]
            if not chunk:
                out.append("&")
            else:
                data = chunk.replace(",", "/")
                out.append(base64.b64decode(data + "=" * (-len(data) % 4)).decode("utf-16-be"))
            i = end + 1
    except (ValueError, binascii.Error, UnicodeDecodeError):
        return name
    return "".join(out)


def quote(name: str) -> str:
    """Mailbox name as an IMAP quoted string. Names that cannot be one are refused."""
    if not name or any(ord(c) < 32 or ord(c) > 126 for c in name):
        raise ProviderNotFound("unusable folder name")
    return '"' + name.replace("\\", "\\\\").replace('"', '\\"') + '"'


def folder_key(name: str) -> str:
    """Stable, column-safe identifier of a folder (its wire name, or a hash when long)."""
    if name.upper() == "INBOX":
        name = "INBOX"
    if len(name) <= MAX_INLINE_NAME:
        return "n" + base64.urlsafe_b64encode(name.encode("utf-8", "replace")).decode().rstrip("=")
    return "h" + hashlib.sha256(name.encode("utf-8", "replace")).hexdigest()[:40]


@dataclass(frozen=True, slots=True)
class Folder:
    name: str  # wire name (modified UTF-7), used verbatim in commands
    key: str
    role: FolderRole
    title: str


def _unquote(raw: bytes) -> str:
    text = raw.decode("utf-8", "replace").strip()
    if len(text) >= 2 and text.startswith('"') and text.endswith('"'):
        return re.sub(r"\\(.)", r"\1", text[1:-1])
    return text


def parse_list(lines: list[object]) -> list[Folder]:
    """Turn ``LIST`` responses into folders with roles. Unparseable lines are skipped."""
    entries: list[tuple[str, set[str], str]] = []
    for line in lines:
        literal: bytes | None = None
        if isinstance(line, tuple) and len(line) == 2 and isinstance(line[0], bytes):
            head, literal = line[0], line[1] if isinstance(line[1], bytes) else None
            head = re.sub(rb"\{\d+\}$", b"", head).rstrip() + b" x"
        elif isinstance(line, bytes):
            head = line
        else:
            continue
        match = _LIST.match(head.strip())
        if match is None:
            continue
        flags = {f.lower() for f in match["flags"].decode("ascii", "replace").split()}
        name = (
            literal.decode("utf-8", "replace") if literal is not None else _unquote(match["name"])
        )
        delim = _unquote(match["delim"]) if match["delim"] != b"NIL" else ""
        if not name or flags & _SKIPPED:
            continue
        try:
            quote(name)
        except ProviderNotFound:
            continue
        entries.append((name, flags, delim))

    roles: dict[str, FolderRole] = {}
    taken: set[FolderRole] = set()
    for name, _flags, _ in entries:
        if name.upper() == "INBOX":
            roles[name] = FolderRole.INBOX
            taken.add(FolderRole.INBOX)
    for name, flags, _ in entries:
        for flag, role in _SPECIAL_USE.items():
            if flag in flags and role not in taken and name not in roles:
                roles[name] = role
                taken.add(role)
    for role, names in _NAMES.items():
        if role in taken:
            continue
        candidates = [
            (name.count(delim) if delim else 0, name)
            for name, _flags, delim in entries
            if name not in roles
            and decode_utf7(name.rsplit(delim, 1)[-1] if delim else name).strip().lower() in names
        ]
        if candidates:
            roles[min(candidates)[1]] = role
            taken.add(role)

    folders = []
    seen: set[str] = set()
    for name, _flags, delim in entries:
        key = folder_key(name)
        if key in seen:
            continue
        seen.add(key)
        role = roles.get(name, FolderRole.CUSTOM)
        title = _ROLE_TITLES.get(role) or decode_utf7(name).replace(delim or "\x00", "/")
        folders.append(Folder(name=name, key=key, role=role, title=title[:255]))
    folders.sort(key=lambda f: (_ROLE_ORDER.index(f.role), f.title.lower(), f.key))
    return folders[:MAX_FOLDERS]


def to_provider_folders(folders: list[Folder]) -> list[ProviderFolder]:
    return [ProviderFolder(f.key, f.title, f.role) for f in folders]


# -- message ids -----------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class MessageRef:
    key: str
    uidvalidity: int
    uid: int


def encode_id(key: str, uidvalidity: int, uid: int) -> str:
    """``<folder key>.<UIDVALIDITY>.<UID>`` — at most 223 characters, unique per mailbox for as
    long as the folder's UIDVALIDITY holds (RFC 3501 2.3.1.1)."""
    return f"{key}.{uidvalidity}.{uid}"


def decode_id(value: str) -> MessageRef:
    match = _ID.match(value)
    if match is None:
        raise ProviderNotFound("not an IMAP message id")
    return MessageRef(match["key"], int(match["validity"]), int(match["uid"]))


# -- UID sets --------------------------------------------------------------------------------


def compress(uids: list[int] | set[int]) -> str:
    """Sorted UIDs as an IMAP sequence set (``1:4,7,9:12``)."""
    ordered = sorted(set(uids))
    parts: list[str] = []
    start = prev = None
    for uid in ordered:
        if prev is not None and uid == prev + 1:
            prev = uid
            continue
        if start is not None:
            parts.append(str(start) if start == prev else f"{start}:{prev}")
        start = prev = uid
    if start is not None:
        parts.append(str(start) if start == prev else f"{start}:{prev}")
    return ",".join(parts)


def expand(sequence: str, *, limit: int = 2_000_000) -> set[int]:
    result: set[int] = set()
    for part in filter(None, sequence.split(",")):
        low, _, high = part.partition(":")
        first, last = int(low), int(high or low)
        if first > last or len(result) + (last - first + 1) > limit:
            raise ValueError("bad uid set")
        result.update(range(first, last + 1))
    return result


# -- cursor ----------------------------------------------------------------------------------


@dataclass(slots=True)
class FolderState:
    uidvalidity: int
    last_uid: int = 0  # every UID up to here has been reported
    modseq: int = 0  # HIGHESTMODSEQ as of the last flag check (0 without CONDSTORE)
    known: set[int] = field(default_factory=set)  # UIDs present at the last check
    flags: dict[int, int] = field(default_factory=dict)  # recent UIDs -> flag bits


@dataclass(slots=True)
class Cursor:
    folders: dict[str, FolderState] = field(default_factory=dict)
    resume: int = 0  # index of the folder the next call starts with


def encode_cursor(cursor: Cursor) -> str:
    payload = {
        "v": 1,
        "r": cursor.resume,
        "f": {
            key: [
                s.uidvalidity,
                s.last_uid,
                s.modseq,
                compress(s.known),
                ",".join(f"{uid}:{bits}" for uid, bits in sorted(s.flags.items())),
            ]
            for key, s in cursor.folders.items()
        },
    }
    return json.dumps(payload, separators=(",", ":"))


def decode_cursor(value: str) -> Cursor:
    """Parse a cursor this adapter issued; anything else means "start over"."""
    try:
        payload = json.loads(value)
        if payload["v"] != 1:
            raise ValueError("version")
        folders: dict[str, FolderState] = {}
        for key, (validity, last_uid, modseq, known, flags) in payload["f"].items():
            pairs = (item.split(":") for item in filter(None, str(flags).split(",")))
            folders[str(key)] = FolderState(
                uidvalidity=int(validity),
                last_uid=int(last_uid),
                modseq=int(modseq),
                known=expand(str(known)),
                flags={int(uid): int(bits) for uid, bits in pairs},
            )
        return Cursor(folders=folders, resume=int(payload.get("r", 0)))
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise ProviderCursorExpired("unreadable imap cursor") from exc


def encode_page_token(key: str, uidvalidity: int, before: int | None) -> str:
    return json.dumps({"k": key, "u": uidvalidity, "b": before}, separators=(",", ":"))


def decode_page_token(value: str) -> tuple[str, int, int | None]:
    try:
        payload = json.loads(value)
        before = payload["b"]
        return str(payload["k"]), int(payload["u"]), None if before is None else int(before)
    except (ValueError, KeyError, TypeError) as exc:
        raise ProviderCursorExpired("unreadable imap page token") from exc


# -- flags -----------------------------------------------------------------------------------

SEEN, FLAGGED, DRAFT, DELETED, ANSWERED = 1, 2, 4, 8, 16
_FLAG_BITS = {
    "\\seen": SEEN,
    "\\flagged": FLAGGED,
    "\\draft": DRAFT,
    "\\deleted": DELETED,
    "\\answered": ANSWERED,
}


def flag_bits(flags: list[str] | tuple[str, ...]) -> int:
    bits = 0
    for flag in flags:
        bits |= _FLAG_BITS.get(flag.lower(), 0)
    return bits
