"""Outlook adapter built on the Microsoft Graph v1.0 mail API.

Every Graph fact this module relies on was checked against learn.microsoft.com on
2026-11-17; the source is cited next to the code that depends on it. The adapter has been
exercised against a mocked Graph only (see docs/LIMITATIONS.md).
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlsplit

import httpx

from app.integrations.email_providers.contracts.errors import (
    ProviderCursorExpired,
    ProviderError,
    ProviderNotFound,
    ProviderUnavailable,
)
from app.integrations.email_providers.contracts.models import (
    Credentials,
    FolderRole,
    MessagePage,
    OutgoingAttachment,
    OutgoingMessage,
    ProviderCapabilities,
    ProviderDraft,
    ProviderFolder,
    ProviderMessage,
    SentMessage,
    SyncChanges,
    ThreadAction,
)
from app.integrations.email_providers.http import ResilientHttp, Sleep
from app.integrations.email_providers.outlook import mapper

API = "https://graph.microsoft.com/v1.0"

# Throttling (https://learn.microsoft.com/en-us/graph/throttling-limits, "Outlook service
# limits"): per application and mailbox, 10,000 requests per 10 minutes, four concurrent
# requests, 150 MB of uploads per 5 minutes. Throttled calls answer 429 with Retry-After.
MAX_CONCURRENT_REQUESTS = 4
# Immutable ids survive moves between folders, so one id identifies a message for its whole
# life in the mailbox. The header applies only to the request that carries it, so it is sent
# with every request. https://learn.microsoft.com/en-us/graph/outlook-immutable-id
PREFER_IMMUTABLE_ID = 'IdType="ImmutableId"'
# List messages accepts $top between 1 and 1000.
# https://learn.microsoft.com/en-us/graph/api/user-list-messages
MAX_PAGE_SIZE = 1000
DELTA_PAGE_SIZE = 200
# Attachments under 3 MB are posted inline; from 3 MB to 150 MB an upload session is required,
# sent in ranges below 4 MB to a pre-authorized URL *without* an Authorization header.
# https://learn.microsoft.com/en-us/graph/outlook-large-attachments
INLINE_ATTACHMENT_LIMIT = 3 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024
MAX_ATTACHMENT_BYTES = 150 * 1024 * 1024
_UPLOAD_HOST_SUFFIXES = (".office.com", ".office365.com", ".microsoft.com")
# Bounds for one ``synchronize`` call; the rest is carried over in the cursor.
DELTA_REQUEST_BUDGET = 100
VERIFY_BUDGET = 300
MAX_FOLDERS = 500
MAX_THREAD_PAGES = 10
# Clock difference tolerated between this server and Exchange when deciding what changed
# while a folder's change tracking was being established.
PRIMING_SKEW = timedelta(minutes=5)
CURSOR_VERSION = 1
# A delta token that can no longer be used: "a 40X-series error with error codes such as
# syncStateNotFound", or 410 Gone. https://learn.microsoft.com/en-us/graph/delta-query-overview
_DELTA_FAILURES = frozenset({400, 404, 410})
_EXPIRED_CODES = frozenset({"syncstatenotfound", "syncstateinvalid", "resyncrequired"})

OUTLOOK_CAPABILITIES = ProviderCapabilities(
    threads=True,  # conversationId
    labels=False,  # a message lives in exactly one folder
    server_search=True,
    drafts=True,
    spam=True,
    archive=True,
    incremental_sync=True,  # per-folder delta queries
    oauth=True,
)

_FLAG_ACTIONS: dict[ThreadAction, dict[str, Any]] = {
    ThreadAction.MARK_READ: {"isRead": True},
    ThreadAction.MARK_UNREAD: {"isRead": False},
    ThreadAction.STAR: {"flag": {"flagStatus": "flagged"}},
    ThreadAction.UNSTAR: {"flag": {"flagStatus": "notFlagged"}},
}
_STAYS_PUT = frozenset({FolderRole.SENT, FolderRole.DRAFTS, FolderRole.SPAM, FolderRole.TRASH})


def _move_target(action: ThreadAction, role: FolderRole | None) -> str | None:
    """Well-known destination for a message currently in a folder of ``role``, or ``None``
    when the action leaves that message where it is."""
    if action is ThreadAction.ARCHIVE:
        return "archive" if role is FolderRole.INBOX else None
    if action is ThreadAction.UNARCHIVE:
        return "inbox" if role is FolderRole.ARCHIVE else None
    if action is ThreadAction.TRASH:
        return "deleteditems" if role is not FolderRole.TRASH else None
    if action is ThreadAction.RESTORE:
        return "inbox" if role is FolderRole.TRASH else None
    if action is ThreadAction.SPAM:
        return "junkemail" if role not in _STAYS_PUT else None
    if action is ThreadAction.NOT_SPAM:
        return "inbox" if role is FolderRole.SPAM else None
    return None


def _id(value: str) -> str:
    return quote(value, safe="")


def _odata_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _error_code(response: httpx.Response) -> str:
    """Machine-readable Graph error code (never the message text)."""
    try:
        error = response.json().get("error", {})
    except (ValueError, AttributeError):
        return ""
    return str(error.get("code", "")).lower() if isinstance(error, dict) else ""


def _relative(link: object) -> str | None:
    """A Graph paging link without its origin, so stored tokens can only ever be replayed
    against Graph itself."""
    if not isinstance(link, str) or not link.lower().startswith(f"{API}/"):
        return None
    return link[len(API) :]


class OutlookProvider:
    def __init__(
        self,
        client: httpx.AsyncClient,
        credentials: Credentials,
        *,
        max_concurrency: int = MAX_CONCURRENT_REQUESTS,
        sleep: Sleep = asyncio.sleep,
        requests_per_minute: float | None = None,
        max_attempts: int = 4,
        delta_request_budget: int = DELTA_REQUEST_BUDGET,
        verify_budget: int = VERIFY_BUDGET,
    ) -> None:
        """``requests_per_minute`` paces calls. Background synchronization passes a budget
        well below the documented limit so the user's own actions always have room;
        interactive requests pass ``None`` (no pacing, fail fast)."""
        self._http = ResilientHttp(client, sleep=sleep, max_attempts=max_attempts, base_delay=1.0)
        self._sleep = sleep
        self._seconds_per_request = 60.0 / requests_per_minute if requests_per_minute else 0.0
        self._next_slot = 0.0
        self._pace_lock = asyncio.Lock()
        self._headers = {
            "Authorization": f"Bearer {credentials.access_token}",
            "Prefer": PREFER_IMMUTABLE_ID,
        }
        self._semaphore = asyncio.Semaphore(max(1, min(max_concurrency, MAX_CONCURRENT_REQUESTS)))
        self._delta_budget = max(1, delta_request_budget)
        self._verify_budget = max(1, verify_budget)
        self._roles: dict[str, FolderRole] | None = None
        self._roles_lock = asyncio.Lock()

    @property
    def capabilities(self) -> ProviderCapabilities:
        return OUTLOOK_CAPABILITIES

    # -- transport -------------------------------------------------------------------------

    async def _pace(self) -> None:
        if self._seconds_per_request <= 0:
            return
        async with self._pace_lock:
            now = asyncio.get_running_loop().time()
            wait = self._next_slot - now
            self._next_slot = max(now, self._next_slot) + self._seconds_per_request
        if wait > 0:
            await self._sleep(wait)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        idempotent: bool = True,
        passthrough: frozenset[int] = frozenset(),
        prefer: str | None = None,
        **kwargs: Any,
    ) -> httpx.Response:
        headers = dict(self._headers)
        if prefer:
            headers["Prefer"] = f"{PREFER_IMMUTABLE_ID}, {prefer}"
        async with self._semaphore:
            await self._pace()
            return await self._http.request(
                method,
                f"{API}{path}",
                headers=headers,
                idempotent=idempotent,
                passthrough=passthrough,
                **kwargs,
            )

    async def _call(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        response = await self._request(method, path, **kwargs)
        if response.status_code in (202, 204) or not response.content:
            return {}
        try:
            data = response.json()
        except ValueError as exc:
            raise ProviderUnavailable("provider returned no JSON") from exc
        if not isinstance(data, dict):
            raise ProviderUnavailable("provider returned unexpected JSON")
        return data

    # -- folders ---------------------------------------------------------------------------

    async def _folder_roles(self) -> dict[str, FolderRole]:
        """Ids of the well-known folders. v1.0 has no ``wellKnownName`` property, so each
        name is resolved once per session; a mailbox may lack some (for example Archive)."""
        async with self._roles_lock:
            if self._roles is None:

                async def one(name: str) -> str | None:
                    try:
                        data = await self._call(
                            "GET", f"/me/mailFolders/{name}", params={"$select": "id"}
                        )
                    except ProviderNotFound:
                        return None
                    return str(data.get("id") or "") or None

                names = list(mapper.WELL_KNOWN_FOLDERS)
                ids = await asyncio.gather(*(one(name) for name in names))
                self._roles = {
                    folder_id: mapper.WELL_KNOWN_FOLDERS[name]
                    for name, folder_id in zip(names, ids, strict=True)
                    if folder_id
                }
            return self._roles

    async def _collection(self, path: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        next_path: str | None = path
        next_params: dict[str, Any] | None = params
        for _ in range(MAX_FOLDERS):
            if next_path is None:
                break
            data = await self._call("GET", next_path, params=next_params)
            items.extend(i for i in data.get("value") or [] if isinstance(i, dict))
            next_path, next_params = _relative(data.get("@odata.nextLink")), None
        return items

    async def _all_folders(self) -> list[dict[str, Any]]:
        """Every visible mail folder. Listing returns only one level, so folders with
        children are walked. https://learn.microsoft.com/en-us/graph/api/user-list-mailfolders"""
        params = {"$select": "id,displayName,parentFolderId,childFolderCount", "$top": 100}
        folders = await self._collection("/me/mailFolders", params)
        queue = [f for f in folders if int(f.get("childFolderCount") or 0) > 0]
        while queue and len(folders) < MAX_FOLDERS:
            parent = queue.pop(0)
            children = await self._collection(
                f"/me/mailFolders/{_id(str(parent['id']))}/childFolders", params
            )
            folders.extend(children)
            queue.extend(c for c in children if int(c.get("childFolderCount") or 0) > 0)
        return [f for f in folders if f.get("id")][:MAX_FOLDERS]

    async def list_folders(self) -> list[ProviderFolder]:
        folders, roles = await asyncio.gather(self._all_folders(), self._folder_roles())
        return mapper.map_folders(folders, roles)

    # -- reading ---------------------------------------------------------------------------

    @staticmethod
    def _page(data: dict[str, Any], cursor: str | None = None) -> MessagePage:
        return MessagePage(
            message_ids=tuple(str(m["id"]) for m in data.get("value") or [] if m.get("id")),
            next_page_token=_relative(data.get("@odata.nextLink")),
            cursor=cursor,
        )

    async def _next_page(self, page_token: str) -> dict[str, Any]:
        # The token is the provider's own next link; it is applied whole, as documented.
        # It is stored without its origin, so it can only be sent to Graph.
        if not page_token.startswith("/"):
            raise ProviderError("invalid page token")
        return await self._call("GET", page_token)

    async def list_messages(self, *, page_token: str | None, page_size: int) -> MessagePage:
        """Whole mailbox, newest first. ``GET /me/messages`` spans every folder, including
        Deleted Items."""
        if page_token is not None:
            return self._page(await self._next_page(page_token))
        # The cursor is fixed *before* listing: the first ``synchronize`` call establishes
        # per-folder change tracking and reports whatever changed from this moment on.
        cursor = json.dumps(
            {"v": CURSOR_VERSION, "since": datetime.now(UTC).isoformat(), "f": {}, "i": 0},
            separators=(",", ":"),
        )
        data = await self._call(
            "GET",
            "/me/messages",
            params={
                "$select": "id",
                "$orderby": "receivedDateTime desc",
                "$top": max(1, min(page_size, MAX_PAGE_SIZE)),
            },
        )
        return self._page(data, cursor)

    async def search_messages(
        self, query: str, *, page_token: str | None, page_size: int
    ) -> MessagePage:
        """Server-side search ($search; at most 1,000 results, newest first).
        https://learn.microsoft.com/en-us/graph/search-query-parameter"""
        if page_token is not None:
            return self._page(await self._next_page(page_token))
        phrase = query.replace("\\", " ").replace('"', " ").strip()
        data = await self._call(
            "GET",
            "/me/messages",
            params={
                "$search": f'"{phrase}"',
                "$select": "id",
                "$top": max(1, min(page_size, MAX_PAGE_SIZE)),
            },
        )
        return self._page(data)

    async def _attachment_list(self, provider_message_id: str) -> list[dict[str, Any]]:
        return await self._collection(
            f"/me/messages/{_id(provider_message_id)}/attachments",
            {"$select": mapper.ATTACHMENT_FIELDS, "$top": 100},
        )

    async def _map(self, data: dict[str, Any]) -> ProviderMessage:
        attachments: list[dict[str, Any]] = []
        if mapper.needs_attachment_lookup(data):
            attachments = await self._attachment_list(str(data["id"]))
        return mapper.map_message(
            data, folder_roles=await self._folder_roles(), attachments=attachments
        )

    async def get_message(self, provider_message_id: str) -> ProviderMessage:
        data = await self._call(
            "GET",
            f"/me/messages/{_id(provider_message_id)}",
            params={"$select": mapper.MESSAGE_FIELDS},
        )
        return await self._map(data)

    async def _conversation(self, provider_thread_id: str, select: str) -> list[dict[str, Any]]:
        # No $orderby: combined with this filter Graph rejects it (InefficientFilter).
        items: list[dict[str, Any]] = []
        path: str | None = "/me/messages"
        params: dict[str, Any] | None = {
            "$filter": f"conversationId eq {_odata_string(provider_thread_id)}",
            "$select": select,
            "$top": 50,
        }
        for _ in range(MAX_THREAD_PAGES):
            if path is None:
                break
            data = await self._call("GET", path, params=params)
            items.extend(i for i in data.get("value") or [] if isinstance(i, dict) and i.get("id"))
            path, params = _relative(data.get("@odata.nextLink")), None
        return items

    async def get_thread(self, provider_thread_id: str) -> list[ProviderMessage]:
        items = await self._conversation(provider_thread_id, mapper.MESSAGE_FIELDS)
        messages = [await self._map(item) for item in items]
        return sorted(messages, key=lambda m: m.sent_at)

    async def get_attachment(self, provider_message_id: str, part_id: str) -> bytes:
        for item in await self._attachment_list(provider_message_id):
            attachment_id = str(item.get("id") or "")
            if attachment_id and mapper.attachment_part_id(attachment_id) == part_id:
                response = await self._request(
                    "GET",
                    f"/me/messages/{_id(provider_message_id)}/attachments/"
                    f"{_id(attachment_id)}/$value",
                )
                return response.content
        raise ProviderNotFound("attachment part missing")

    # -- incremental synchronization -------------------------------------------------------

    @staticmethod
    def _load_cursor(cursor: str) -> tuple[datetime, dict[str, dict[str, Any]], int]:
        try:
            data = json.loads(cursor)
            if data["v"] != CURSOR_VERSION:
                raise ValueError("version")
            since = mapper.parse_datetime(data["since"])
            folders = data["f"]
            index = int(data.get("i", 0))
            if since is None or not isinstance(folders, dict):
                raise ValueError("shape")
            states = {
                str(k): {"l": str(v["l"]), "p": int(v.get("p", 0))} for k, v in folders.items()
            }
        except (ValueError, KeyError, TypeError) as exc:
            raise ProviderCursorExpired("unreadable sync cursor") from exc
        return since, states, index

    async def _delta_page(self, link: str) -> dict[str, Any]:
        if not link.startswith("/"):  # links are stored without their origin
            raise ProviderCursorExpired("unreadable sync cursor")
        response = await self._request(
            "GET", link, passthrough=_DELTA_FAILURES, prefer=f"odata.maxpagesize={DELTA_PAGE_SIZE}"
        )
        status = response.status_code
        if status in _DELTA_FAILURES:
            # 404: the folder is gone; 410 / syncStateNotFound: the token expired. Either way
            # the changes since the token cannot be recovered, so a full resync is required.
            if status != 400 or _error_code(response) in _EXPIRED_CODES:
                raise ProviderCursorExpired("delta token expired")
            raise ProviderError("provider rejected request (400)")
        try:
            data = response.json()
        except ValueError as exc:
            raise ProviderUnavailable("provider returned no JSON") from exc
        if not isinstance(data, dict):
            raise ProviderUnavailable("provider returned unexpected JSON")
        return data

    async def _exists(self, provider_message_id: str) -> bool:
        try:
            await self._call(
                "GET", f"/me/messages/{_id(provider_message_id)}", params={"$select": "id"}
            )
        except ProviderNotFound:
            return False
        return True

    async def synchronize(self, cursor: str) -> SyncChanges:
        """Changes since ``cursor``, gathered from one delta query per folder.

        Delta is a per-folder operation (https://learn.microsoft.com/en-us/graph/delta-query-messages),
        so the opaque cursor holds one link per folder. A folder seen for the first time is
        *primed*: its initial round is walked only to obtain a delta link, reporting just the
        messages modified since the cursor was created (the rest is the backfill's job).
        Work per call is bounded; unfinished rounds continue from the returned cursor.

        A move shows up as ``@removed`` in the source folder and as a new item in the
        destination. Because folders are polled one after another, every removal is checked
        against the mailbox before it is reported as a deletion.
        """
        since, states, start = self._load_cursor(cursor)
        folder_ids = [str(f["id"]) for f in await self._all_folders()]
        if any(folder_id not in folder_ids for folder_id in states):
            # A tracked folder vanished together with its messages; which ones cannot be
            # told from here, so the local copy is rebuilt.
            raise ProviderCursorExpired("tracked folder no longer exists")
        threshold = since - PRIMING_SKEW
        upserted: dict[str, None] = {}
        deleted: dict[str, None] = {}
        checked: dict[str, bool] = {}  # removed id -> still exists somewhere in the mailbox
        budget, verify_budget = self._delta_budget, self._verify_budget
        count = len(folder_ids)
        start = start % count if count else 0
        resume = 0
        for offset in range(count):
            position = (start + offset) % count
            if budget <= 0:
                resume = position
                break
            folder_id = folder_ids[position]
            state = states.get(folder_id) or {
                "l": f"/me/mailFolders/{_id(folder_id)}/messages/delta"
                "?$select=lastModifiedDateTime",
                "p": 1,
            }
            finished = False
            while budget > 0 and not finished:
                budget -= 1
                data = await self._delta_page(state["l"])
                changed: list[str] = []
                removed: list[str] = []
                for item in data.get("value") or []:
                    message_id = str(item.get("id") or "") if isinstance(item, dict) else ""
                    if not message_id:
                        continue
                    if "@removed" in item:
                        removed.append(message_id)
                    elif state["p"]:
                        modified = mapper.parse_datetime(item.get("lastModifiedDateTime"))
                        if modified is None or modified >= threshold:
                            changed.append(message_id)
                    else:
                        changed.append(message_id)
                unverified = [m for m in dict.fromkeys(removed) if m not in checked]
                if len(unverified) > verify_budget:
                    # Not enough room left to check this page; it is replayed next time.
                    budget = 0
                    break
                verify_budget -= len(unverified)
                present = await asyncio.gather(*(self._exists(m) for m in unverified))
                checked.update(zip(unverified, present, strict=True))
                for message_id in changed:
                    upserted[message_id] = None
                for message_id in removed:
                    if checked[message_id]:
                        upserted[message_id] = None  # moved, not deleted
                    else:
                        deleted[message_id] = None
                next_link = _relative(data.get("@odata.nextLink"))
                delta_link = _relative(data.get("@odata.deltaLink"))
                if next_link:
                    state = {"l": next_link, "p": state["p"]}
                elif delta_link:
                    state = {"l": delta_link, "p": 0}
                    finished = True
                else:
                    raise ProviderUnavailable("delta response without a state link")
                states[folder_id] = state
            if not finished:
                resume = position
                break
        for message_id in deleted:
            upserted.pop(message_id, None)
        new_cursor = json.dumps(
            {"v": CURSOR_VERSION, "since": since.isoformat(), "f": states, "i": resume},
            separators=(",", ":"),
        )
        return SyncChanges(tuple(upserted), tuple(deleted), new_cursor)

    # -- modifying -------------------------------------------------------------------------

    async def _move(self, provider_message_id: str, destination: str) -> None:
        # With immutable ids the message keeps its id, so repeating a move after a lost
        # response cannot create a second copy; the call is safe to retry.
        await self._call(
            "POST",
            f"/me/messages/{_id(provider_message_id)}/move",
            json={"destinationId": destination},
        )

    async def _apply(self, items: list[dict[str, Any]], action: ThreadAction) -> None:
        patch = _FLAG_ACTIONS.get(action)
        if patch is not None:
            await asyncio.gather(
                *(
                    self._call("PATCH", f"/me/messages/{_id(str(item['id']))}", json=patch)
                    for item in items
                )
            )
            return
        roles = await self._folder_roles()
        moves = []
        for item in items:
            target = _move_target(action, roles.get(str(item.get("parentFolderId") or "")))
            if target is not None:
                moves.append(self._move(str(item["id"]), target))
        await asyncio.gather(*moves)

    async def modify_thread(self, provider_thread_id: str, action: ThreadAction) -> None:
        """Graph has no conversation-level actions: the action is applied to each message
        of the conversation."""
        items = await self._conversation(provider_thread_id, "id,parentFolderId")
        if not items:
            raise ProviderNotFound("conversation has no messages")
        await self._apply(items, action)

    async def modify_message(self, provider_message_id: str, action: ThreadAction) -> None:
        if action in _FLAG_ACTIONS:
            await self._apply([{"id": provider_message_id}], action)
            return
        item = await self._call(
            "GET",
            f"/me/messages/{_id(provider_message_id)}",
            params={"$select": "id,parentFolderId"},
        )
        await self._apply([item], action)

    async def delete_message(self, provider_message_id: str) -> None:
        await self._move(provider_message_id, "deleteditems")

    # -- sending and drafts ----------------------------------------------------------------

    async def _find_by_internet_id(self, internet_message_id: str) -> str | None:
        data = await self._call(
            "GET",
            "/me/messages",
            params={
                "$filter": f"internetMessageId eq {_odata_string(internet_message_id.strip())}",
                "$select": "id",
                "$top": 1,
            },
        )
        for item in data.get("value") or []:
            if isinstance(item, dict) and item.get("id"):
                return str(item["id"])
        return None

    async def _upload_large(self, draft_id: str, attachment: OutgoingAttachment) -> None:
        session = await self._call(
            "POST",
            f"/me/messages/{_id(draft_id)}/attachments/createUploadSession",
            idempotent=False,
            json=mapper.build_upload_session(attachment),
        )
        upload_url = str(session.get("uploadUrl") or "")
        target = urlsplit(upload_url)
        host = target.hostname or ""
        if target.scheme != "https" or not host.endswith(_UPLOAD_HOST_SUFFIXES):
            raise ProviderError("unexpected upload session target")
        total = len(attachment.content)
        for start in range(0, total, UPLOAD_CHUNK_BYTES):
            chunk = attachment.content[start : start + UPLOAD_CHUNK_BYTES]
            async with self._semaphore:
                await self._pace()
                # The URL is pre-authorized: no Authorization header may be sent.
                await self._http.request(
                    "PUT",
                    upload_url,
                    idempotent=False,
                    content=chunk,
                    headers={
                        "Content-Type": "application/octet-stream",
                        "Content-Range": f"bytes {start}-{start + len(chunk) - 1}/{total}",
                    },
                )

    async def _attach(self, draft_id: str, attachments: tuple[OutgoingAttachment, ...]) -> None:
        for attachment in attachments:
            size = len(attachment.content)
            if size > MAX_ATTACHMENT_BYTES:
                raise ProviderError("attachment exceeds the provider limit")
            if size < INLINE_ATTACHMENT_LIMIT:
                await self._call(
                    "POST",
                    f"/me/messages/{_id(draft_id)}/attachments",
                    idempotent=False,
                    json=mapper.build_file_attachment(attachment),
                )
            else:
                await self._upload_large(draft_id, attachment)

    async def _discard(self, draft_id: str) -> None:
        try:
            await self._call("DELETE", f"/me/messages/{_id(draft_id)}")
        except ProviderError:
            pass  # best effort; the leftover draft is visible in the mailbox

    async def _new_draft(self, message: OutgoingMessage) -> dict[str, Any]:
        """Create the draft, as a reply when the original can be found.

        Graph offers no way to set In-Reply-To / References on a JSON message (only custom
        ``x-`` headers), so a reply is started with ``createReply`` on the original — which
        keeps the conversation and the threading headers — and then given our content.
        If the original is not in the mailbox the message goes out as a new conversation.
        """
        payload = mapper.build_message(message)
        source_id = None
        if message.in_reply_to:
            source_id = await self._find_by_internet_id(message.in_reply_to)
        if source_id is None:
            draft = await self._call("POST", "/me/messages", idempotent=False, json=payload)
        else:
            draft = await self._call(
                "POST", f"/me/messages/{_id(source_id)}/createReply", idempotent=False
            )
        draft_id = str(draft.get("id") or "")
        if not draft_id:
            raise ProviderUnavailable("draft was not created")
        try:
            if source_id is not None:
                draft = await self._call("PATCH", f"/me/messages/{_id(draft_id)}", json=payload)
            await self._attach(draft_id, message.attachments)
        except Exception:
            await self._discard(draft_id)
            raise
        return {"id": draft_id, "conversationId": draft.get("conversationId")}

    @staticmethod
    def _draft(data: dict[str, Any]) -> ProviderDraft:
        draft_id = str(data["id"])
        return ProviderDraft(
            provider_draft_id=draft_id,
            provider_message_id=draft_id,
            provider_thread_id=str(data.get("conversationId") or draft_id),
        )

    async def _send(self, draft_id: str) -> None:
        # 202 Accepted with no body. Never retried after an ambiguous failure.
        await self._call("POST", f"/me/messages/{_id(draft_id)}/send", idempotent=False)

    async def send_message(self, message: OutgoingMessage) -> SentMessage:
        """Create a draft and send it. With immutable ids the sent copy keeps the draft's
        id, which is how the caller finds it in Sent Items afterwards."""
        draft = self._draft(await self._new_draft(message))
        try:
            await self._send(draft.provider_draft_id)
        except ProviderUnavailable:
            raise  # outcome unknown: the draft is left alone rather than risk deleting mail
        except ProviderError:
            await self._discard(draft.provider_draft_id)  # definitely not sent
            raise
        return SentMessage(draft.provider_message_id, draft.provider_thread_id)

    async def reply_message(self, message: OutgoingMessage) -> SentMessage:
        return await self.send_message(message)

    async def forward_message(self, message: OutgoingMessage) -> SentMessage:
        return await self.send_message(message)

    async def create_draft(self, message: OutgoingMessage) -> ProviderDraft:
        return self._draft(await self._new_draft(message))

    async def update_draft(self, provider_draft_id: str, message: OutgoingMessage) -> ProviderDraft:
        """Replace the draft's subject, body and recipients in place (the id is kept).
        Existing attachments are left untouched; any given here are added."""
        data = await self._call(
            "PATCH", f"/me/messages/{_id(provider_draft_id)}", json=mapper.build_message(message)
        )
        await self._attach(provider_draft_id, message.attachments)
        return self._draft({"id": provider_draft_id, "conversationId": data.get("conversationId")})

    async def delete_draft(self, provider_draft_id: str) -> None:
        await self._call("DELETE", f"/me/messages/{_id(provider_draft_id)}")

    async def send_draft(self, provider_draft_id: str) -> SentMessage:
        data = await self._call(
            "GET",
            f"/me/messages/{_id(provider_draft_id)}",
            params={"$select": "id,conversationId"},
        )
        await self._send(provider_draft_id)
        return SentMessage(provider_draft_id, str(data.get("conversationId") or provider_draft_id))
