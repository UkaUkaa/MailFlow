"""Gmail adapter built on the Gmail REST API."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from app.integrations.email_providers.contracts.errors import (
    ProviderCursorExpired,
    ProviderNotFound,
)
from app.integrations.email_providers.contracts.models import (
    Credentials,
    MessagePage,
    OutgoingMessage,
    ProviderCapabilities,
    ProviderDraft,
    ProviderFolder,
    ProviderMessage,
    SentMessage,
    SyncChanges,
    ThreadAction,
)
from app.integrations.email_providers.gmail import mapper
from app.integrations.email_providers.http import ResilientHttp, Sleep

API = "https://gmail.googleapis.com/gmail/v1/users/me"
# Quota costs from https://developers.google.com/workspace/gmail/api/reference/quota
# (checked 2026-11). The per-user limit is 6,000 units per minute, and reading one message
# with format=full costs 60 — so a mailbox can be read at 100 messages per minute at most.
COST_MESSAGE_GET_FULL = 60
COST_THREAD_GET_FULL = 120
COST_LIST = 5
COST_HISTORY = 2
COST_MODIFY = 10
COST_SEND = 100
COST_DRAFT = 10
COST_ATTACHMENT = 20
COST_CHEAP = 1

GMAIL_CAPABILITIES = ProviderCapabilities(
    threads=True,
    labels=True,
    server_search=True,
    drafts=True,
    spam=True,
    archive=True,
    incremental_sync=True,
    oauth=True,
)

# (labels to add, labels to remove) for label-based actions.
_LABEL_ACTIONS: dict[ThreadAction, tuple[list[str], list[str]]] = {
    ThreadAction.MARK_READ: ([], ["UNREAD"]),
    ThreadAction.MARK_UNREAD: (["UNREAD"], []),
    ThreadAction.STAR: (["STARRED"], []),
    ThreadAction.UNSTAR: ([], ["STARRED"]),
    ThreadAction.ARCHIVE: ([], ["INBOX"]),
    ThreadAction.UNARCHIVE: (["INBOX"], []),
    ThreadAction.SPAM: (["SPAM"], ["INBOX"]),
    ThreadAction.NOT_SPAM: (["INBOX"], ["SPAM"]),
}


class GmailProvider:
    def __init__(
        self,
        client: httpx.AsyncClient,
        credentials: Credentials,
        *,
        max_concurrency: int = 4,
        sleep: Sleep = asyncio.sleep,
        units_per_minute: float | None = None,
        max_attempts: int = 4,
    ) -> None:
        """``units_per_minute`` paces calls by their quota cost. Background synchronization
        passes a budget below the provider limit so the user's own actions always have room;
        interactive requests pass ``None`` (no pacing, fail fast)."""
        self._http = ResilientHttp(client, sleep=sleep, max_attempts=max_attempts, base_delay=1.0)
        self._sleep = sleep
        self._seconds_per_unit = 60.0 / units_per_minute if units_per_minute else 0.0
        self._next_slot = 0.0
        self._pace_lock = asyncio.Lock()
        self._headers = {"Authorization": f"Bearer {credentials.access_token}"}
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._draft_ids: dict[str, str] | None = None

    @property
    def capabilities(self) -> ProviderCapabilities:
        return GMAIL_CAPABILITIES

    async def _pace(self, cost: int) -> None:
        """Reserve ``cost`` units of the per-minute budget, waiting for our turn if needed."""
        if self._seconds_per_unit <= 0:
            return
        async with self._pace_lock:
            now = asyncio.get_running_loop().time()
            wait = self._next_slot - now
            self._next_slot = max(now, self._next_slot) + cost * self._seconds_per_unit
        if wait > 0:
            await self._sleep(wait)

    async def _call(
        self,
        method: str,
        path: str,
        *,
        cost: int,
        idempotent: bool = True,
        **kwargs: Any,
    ) -> dict[str, Any]:
        async with self._semaphore:
            await self._pace(cost)
            response = await self._http.request(
                method, f"{API}{path}", headers=self._headers, idempotent=idempotent, **kwargs
            )
        if response.status_code == 204 or not response.content:
            return {}
        data: dict[str, Any] = response.json()
        return data

    # -- reading ---------------------------------------------------------------------------

    async def list_messages(self, *, page_token: str | None, page_size: int) -> MessagePage:
        cursor = None
        if page_token is None:
            # Capture the history id *before* listing so no change is missed in between.
            profile = await self._call("GET", "/profile", cost=COST_CHEAP)
            cursor = str(profile.get("historyId", "")) or None
        params: dict[str, Any] = {"maxResults": page_size, "includeSpamTrash": "true"}
        if page_token:
            params["pageToken"] = page_token
        data = await self._call("GET", "/messages", cost=COST_LIST, params=params)
        return MessagePage(
            message_ids=tuple(str(m["id"]) for m in data.get("messages") or []),
            next_page_token=data.get("nextPageToken"),
            cursor=cursor,
        )

    async def search_messages(
        self, query: str, *, page_token: str | None, page_size: int
    ) -> MessagePage:
        params: dict[str, Any] = {"maxResults": page_size, "q": query}
        if page_token:
            params["pageToken"] = page_token
        data = await self._call("GET", "/messages", cost=COST_LIST, params=params)
        return MessagePage(
            message_ids=tuple(str(m["id"]) for m in data.get("messages") or []),
            next_page_token=data.get("nextPageToken"),
        )

    async def _resolve_draft_id(self, provider_message_id: str) -> str | None:
        if self._draft_ids is None:
            mapping: dict[str, str] = {}
            page_token: str | None = None
            for _ in range(10):
                params: dict[str, Any] = {"maxResults": 500}
                if page_token:
                    params["pageToken"] = page_token
                data = await self._call("GET", "/drafts", cost=COST_LIST, params=params)
                for draft in data.get("drafts") or []:
                    mapping[str(draft.get("message", {}).get("id", ""))] = str(draft["id"])
                page_token = data.get("nextPageToken")
                if not page_token:
                    break
            self._draft_ids = mapping
        return self._draft_ids.get(provider_message_id)

    async def _map(self, data: dict[str, Any]) -> ProviderMessage:
        draft_id = None
        if "DRAFT" in (data.get("labelIds") or []):
            draft_id = await self._resolve_draft_id(str(data["id"]))
        return mapper.map_message(data, draft_id=draft_id)

    async def get_message(self, provider_message_id: str) -> ProviderMessage:
        data = await self._call(
            "GET",
            f"/messages/{provider_message_id}",
            cost=COST_MESSAGE_GET_FULL,
            params={"format": "full"},
        )
        return await self._map(data)

    async def get_thread(self, provider_thread_id: str) -> list[ProviderMessage]:
        data = await self._call(
            "GET",
            f"/threads/{provider_thread_id}",
            cost=COST_THREAD_GET_FULL,
            params={"format": "full"},
        )
        return [await self._map(m) for m in data.get("messages") or []]

    async def list_folders(self) -> list[ProviderFolder]:
        data = await self._call("GET", "/labels", cost=COST_CHEAP)
        return mapper.map_labels(data.get("labels") or [])

    async def synchronize(self, cursor: str) -> SyncChanges:
        upserted: dict[str, None] = {}
        deleted: dict[str, None] = {}
        latest = cursor
        page_token: str | None = None
        while True:
            params: dict[str, Any] = {"startHistoryId": cursor, "maxResults": 500}
            if page_token:
                params["pageToken"] = page_token
            try:
                data = await self._call("GET", "/history", cost=COST_HISTORY, params=params)
            except ProviderNotFound as exc:
                raise ProviderCursorExpired("history id expired") from exc
            latest = str(data.get("historyId", latest))
            for record in data.get("history") or []:
                for key in ("messagesAdded", "labelsAdded", "labelsRemoved"):
                    for item in record.get(key) or []:
                        message_id = str(item.get("message", {}).get("id", ""))
                        if message_id:
                            upserted[message_id] = None
                for item in record.get("messagesDeleted") or []:
                    message_id = str(item.get("message", {}).get("id", ""))
                    if message_id:
                        deleted[message_id] = None
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        for message_id in deleted:
            upserted.pop(message_id, None)
        return SyncChanges(tuple(upserted), tuple(deleted), latest)

    async def get_attachment(self, provider_message_id: str, part_id: str) -> bytes:
        data = await self._call(
            "GET",
            f"/messages/{provider_message_id}",
            cost=COST_MESSAGE_GET_FULL,
            params={"format": "full"},
        )
        payload = data.get("payload") or {}
        attachment_id = mapper.find_attachment_id(payload, part_id)
        if attachment_id is None:
            inline = mapper.find_inline_data(payload, part_id)
            if inline is None:
                raise ProviderNotFound("attachment part missing")
            return inline
        blob = await self._call(
            "GET",
            f"/messages/{provider_message_id}/attachments/{attachment_id}",
            cost=COST_ATTACHMENT,
        )
        return mapper.b64url_decode(str(blob.get("data", "")))

    # -- modifying -------------------------------------------------------------------------

    async def _modify(self, kind: str, remote_id: str, action: ThreadAction) -> None:
        if action is ThreadAction.TRASH:
            await self._call("POST", f"/{kind}/{remote_id}/trash", cost=COST_MODIFY)
        elif action is ThreadAction.RESTORE:
            await self._call("POST", f"/{kind}/{remote_id}/untrash", cost=COST_MODIFY)
            await self._call(
                "POST",
                f"/{kind}/{remote_id}/modify",
                cost=COST_MODIFY,
                json={"addLabelIds": ["INBOX"]},
            )
        else:
            add, remove = _LABEL_ACTIONS[action]
            await self._call(
                "POST",
                f"/{kind}/{remote_id}/modify",
                cost=COST_MODIFY,
                json={"addLabelIds": add, "removeLabelIds": remove},
            )

    async def modify_thread(self, provider_thread_id: str, action: ThreadAction) -> None:
        await self._modify("threads", provider_thread_id, action)

    async def modify_message(self, provider_message_id: str, action: ThreadAction) -> None:
        await self._modify("messages", provider_message_id, action)

    async def delete_message(self, provider_message_id: str) -> None:
        await self._call("POST", f"/messages/{provider_message_id}/trash", cost=COST_MODIFY)

    # -- sending and drafts ----------------------------------------------------------------

    @staticmethod
    def _raw(message: OutgoingMessage) -> dict[str, Any]:
        body: dict[str, Any] = {"raw": mapper.b64url_encode(mapper.build_mime(message))}
        if message.provider_thread_id:
            body["threadId"] = message.provider_thread_id
        return body

    async def send_message(self, message: OutgoingMessage) -> SentMessage:
        data = await self._call(
            "POST", "/messages/send", cost=COST_SEND, idempotent=False, json=self._raw(message)
        )
        return SentMessage(str(data["id"]), str(data.get("threadId") or data["id"]))

    async def reply_message(self, message: OutgoingMessage) -> SentMessage:
        return await self.send_message(message)

    async def forward_message(self, message: OutgoingMessage) -> SentMessage:
        return await self.send_message(message)

    @staticmethod
    def _draft(data: dict[str, Any]) -> ProviderDraft:
        message = data.get("message") or {}
        return ProviderDraft(
            provider_draft_id=str(data["id"]),
            provider_message_id=str(message["id"]),
            provider_thread_id=str(message.get("threadId") or message["id"]),
        )

    async def create_draft(self, message: OutgoingMessage) -> ProviderDraft:
        data = await self._call(
            "POST",
            "/drafts",
            cost=COST_DRAFT,
            idempotent=False,
            json={"message": self._raw(message)},
        )
        return self._draft(data)

    async def update_draft(self, provider_draft_id: str, message: OutgoingMessage) -> ProviderDraft:
        data = await self._call(
            "PUT",
            f"/drafts/{provider_draft_id}",
            cost=COST_DRAFT,
            json={"message": self._raw(message)},
        )
        return self._draft(data)

    async def delete_draft(self, provider_draft_id: str) -> None:
        await self._call("DELETE", f"/drafts/{provider_draft_id}", cost=COST_DRAFT)

    async def send_draft(self, provider_draft_id: str) -> SentMessage:
        data = await self._call(
            "POST",
            "/drafts/send",
            cost=COST_SEND,
            idempotent=False,
            json={"id": provider_draft_id},
        )
        return SentMessage(str(data["id"]), str(data.get("threadId") or data["id"]))
