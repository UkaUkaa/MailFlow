from __future__ import annotations

import builtins
import uuid
from dataclasses import dataclass
from typing import Protocol

from app.integrations.email_providers.contracts import FolderRole
from app.modules.emails.domain.entities import (
    DraftMeta,
    Message,
    MessageFlags,
    MessageState,
    StoredMessage,
    ThreadState,
    ThreadSummary,
)
from app.shared.application.pagination import KeysetCursor


@dataclass(frozen=True, slots=True)
class ThreadFilter:
    role: FolderRole | None = FolderRole.INBOX
    account_id: uuid.UUID | None = None
    # (account id, provider folder id) of a custom folder; overrides ``role`` when set.
    custom_folder: tuple[uuid.UUID, str] | None = None
    unread_only: bool = False


@dataclass(frozen=True, slots=True)
class SanitizedBody:
    html: str
    has_remote_images: bool


class HtmlSanitizer(Protocol):
    def sanitize(self, raw_html: str) -> SanitizedBody: ...
    def to_text(self, sanitized_html: str) -> str: ...


class MailRepository(Protocol):
    async def upsert_thread(
        self, user_id: uuid.UUID, account_id: uuid.UUID, provider_thread_id: str
    ) -> uuid.UUID: ...
    async def upsert_message(
        self,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        thread_id: uuid.UUID,
        message: StoredMessage,
    ) -> uuid.UUID: ...
    async def delete_by_provider_ids(
        self, user_id: uuid.UUID, account_id: uuid.UUID, provider_message_ids: builtins.list[str]
    ) -> builtins.list[uuid.UUID]:
        """Delete messages; return ids of the threads they belonged to."""

    async def delete_message(self, user_id: uuid.UUID, message_id: uuid.UUID) -> None: ...
    async def purge_account(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None: ...
    async def delete_empty_threads(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        """Remove threads left without messages (e.g. after a message moved threads)."""

    async def message_states(
        self, user_id: uuid.UUID, thread_id: uuid.UUID
    ) -> builtins.list[MessageState]: ...
    async def save_thread_state(
        self, user_id: uuid.UUID, thread_id: uuid.UUID, state: ThreadState | None
    ) -> None:
        """Persist the derived summary; ``None`` deletes the (now empty) thread."""

    async def list_threads(
        self, user_id: uuid.UUID, flt: ThreadFilter, cursor: KeysetCursor | None, limit: int
    ) -> builtins.list[ThreadSummary]: ...
    async def search_threads(
        self,
        user_id: uuid.UUID,
        query: str,
        account_id: uuid.UUID | None,
        cursor: KeysetCursor | None,
        limit: int,
    ) -> builtins.list[ThreadSummary]: ...
    async def get_thread(
        self, user_id: uuid.UUID, thread_id: uuid.UUID
    ) -> ThreadSummary | None: ...
    async def list_messages(
        self, user_id: uuid.UUID, thread_id: uuid.UUID
    ) -> builtins.list[Message]: ...
    async def get_message(self, user_id: uuid.UUID, message_id: uuid.UUID) -> Message | None: ...
    async def set_flags(
        self, user_id: uuid.UUID, message_id: uuid.UUID, flags: MessageFlags
    ) -> None: ...
    async def set_draft_meta(
        self, user_id: uuid.UUID, message_id: uuid.UUID, meta: DraftMeta
    ) -> None: ...
    async def repoint_draft(
        self,
        user_id: uuid.UUID,
        message_id: uuid.UUID,
        *,
        provider_message_id: str,
        provider_draft_id: str,
    ) -> None:
        """Keep a draft's local id stable when the provider assigns it a new message id."""

    async def relocate_message(
        self, user_id: uuid.UUID, account_id: uuid.UUID, old_id: str, new_id: str
    ) -> None:
        """Give a stored message (and a thread named after it) its new provider id after the
        provider moved it. If the new id is already stored, the stale row is dropped."""

    async def unread_counts(
        self, user_id: uuid.UUID, account_id: uuid.UUID | None
    ) -> dict[FolderRole, int]: ...
