"""Read side: thread lists, conversation detail, counts, search."""

from __future__ import annotations

import builtins
import re
import uuid
from dataclasses import dataclass

from app.integrations.email_providers.contracts import FolderRole
from app.modules.attachments.application import Attachment, AttachmentService
from app.modules.emails.application.ports import MailRepository, ThreadFilter
from app.modules.emails.domain.entities import VIEW_ROLES, Message, ThreadSummary
from app.modules.folders.application import FolderService
from app.shared.application.pagination import KeysetCursor, Page, clamp_limit
from app.shared.domain.errors import InvalidInputError, NotFoundError

MAX_QUERY_TERMS = 8


@dataclass(frozen=True, slots=True)
class MessageView:
    message: Message
    attachments: builtins.list[Attachment]


@dataclass(frozen=True, slots=True)
class ThreadDetail:
    summary: ThreadSummary
    messages: builtins.list[MessageView]


def _page(rows: builtins.list[ThreadSummary], limit: int) -> Page[ThreadSummary]:
    items = rows[:limit]
    next_cursor = None
    if len(rows) > limit and items:
        last = items[-1]
        next_cursor = KeysetCursor(at=last.last_message_at, id=str(last.id)).encode()
    return Page(items=items, next_cursor=next_cursor)


def build_prefix_query(text: str) -> str | None:
    """Turn free text into a safe prefix tsquery.

    Only word characters and ``@ . -`` survive, so no tsquery operator or quote can be
    injected. Plain words become ``word:*``; address-like terms are quoted so PostgreSQL
    tokenizes them the same way it did when indexing (e.g. as one email token).
    """
    parts: list[str] = []
    for raw in re.findall(r"[\w@.\-]+", text.lower(), flags=re.UNICODE):
        term = raw.strip("@.-")
        if not term:
            continue
        parts.append(f"{term}:*" if re.fullmatch(r"\w+", term) else f"'{term}':*")
        if len(parts) >= MAX_QUERY_TERMS:
            break
    return " & ".join(parts) if parts else None


class ThreadQueryService:
    def __init__(
        self, mail: MailRepository, folders: FolderService, attachments: AttachmentService
    ) -> None:
        self._mail = mail
        self._folders = folders
        self._attachments = attachments

    async def list(
        self,
        user_id: uuid.UUID,
        *,
        view: str | None,
        account_id: uuid.UUID | None,
        folder_id: uuid.UUID | None,
        unread_only: bool,
        cursor: str | None,
        limit: int | None,
    ) -> Page[ThreadSummary]:
        size = clamp_limit(limit)
        if folder_id is not None:
            folder = await self._folders.get(user_id, folder_id)  # 404 for foreign folders
            if folder.role is FolderRole.CUSTOM:
                flt = ThreadFilter(
                    role=None,
                    account_id=folder.account_id,
                    custom_folder=(folder.account_id, folder.provider_folder_id),
                    unread_only=unread_only,
                )
            else:
                flt = ThreadFilter(folder.role, folder.account_id, unread_only=unread_only)
        else:
            try:
                role = FolderRole(view or "inbox")
            except ValueError as exc:
                raise InvalidInputError("Unknown view.") from exc
            if role not in VIEW_ROLES:
                raise InvalidInputError("Unknown view.")
            flt = ThreadFilter(role, account_id, unread_only=unread_only)
        rows = await self._mail.list_threads(user_id, flt, KeysetCursor.decode(cursor), size + 1)
        return _page(rows, size)

    async def search(
        self,
        user_id: uuid.UUID,
        *,
        query: str,
        account_id: uuid.UUID | None,
        cursor: str | None,
        limit: int | None,
    ) -> Page[ThreadSummary]:
        size = clamp_limit(limit)
        tsquery = build_prefix_query(query)
        if tsquery is None:
            return Page(items=[], next_cursor=None)
        rows = await self._mail.search_threads(
            user_id, tsquery, account_id, KeysetCursor.decode(cursor), size + 1
        )
        return _page(rows, size)

    async def get_summary(self, user_id: uuid.UUID, thread_id: uuid.UUID) -> ThreadSummary:
        summary = await self._mail.get_thread(user_id, thread_id)
        if summary is None:
            raise NotFoundError
        return summary

    async def get_detail(self, user_id: uuid.UUID, thread_id: uuid.UUID) -> ThreadDetail:
        summary = await self.get_summary(user_id, thread_id)
        messages = await self._mail.list_messages(user_id, thread_id)
        attachments = await self._attachments.list_for_messages(user_id, [m.id for m in messages])
        return ThreadDetail(summary, [MessageView(m, attachments.get(m.id, [])) for m in messages])

    async def get_message(self, user_id: uuid.UUID, message_id: uuid.UUID) -> MessageView:
        message = await self._mail.get_message(user_id, message_id)
        if message is None:
            raise NotFoundError
        attachments = await self._attachments.list_for_messages(user_id, [message.id])
        return MessageView(message, attachments.get(message.id, []))

    async def sent_samples(
        self, user_id: uuid.UUID, account_id: uuid.UUID, recipient_email: str | None, limit: int
    ) -> builtins.list[Message]:
        """Messages the user wrote from this mailbox: to ``recipient_email`` first, then any."""
        found: builtins.list[Message] = []
        if recipient_email:
            found = await self._mail.list_sent_messages(
                user_id, account_id, recipient_email=recipient_email, limit=limit
            )
        if len(found) < limit:
            seen = {m.id for m in found}
            more = await self._mail.list_sent_messages(
                user_id, account_id, recipient_email=None, limit=limit * 2
            )
            found += [m for m in more if m.id not in seen][: limit - len(found)]
        return found

    async def unread_counts(
        self, user_id: uuid.UUID, account_id: uuid.UUID | None
    ) -> dict[FolderRole, int]:
        return await self._mail.unread_counts(user_id, account_id)
