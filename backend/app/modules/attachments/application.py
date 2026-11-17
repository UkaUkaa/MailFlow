"""Attachment metadata and authorized retrieval. Bytes are never stored by MailFlow."""

from __future__ import annotations

import builtins
import uuid
from dataclasses import dataclass
from typing import Protocol

from app.integrations.email_providers.contracts import ProviderAttachment
from app.modules.email_accounts.application.sessions import ProviderSessionFactory
from app.shared.domain.errors import NotFoundError, PayloadTooLargeError


@dataclass(frozen=True, slots=True)
class Attachment:
    id: uuid.UUID
    account_id: uuid.UUID
    message_id: uuid.UUID
    provider_message_id: str
    part_id: str
    filename: str
    mime_type: str
    size: int
    is_inline: bool


@dataclass(frozen=True, slots=True)
class NormalizedAttachment:
    part_id: str
    filename: str
    mime_type: str
    size: int
    content_id: str | None
    is_inline: bool


class AttachmentNormalizer(Protocol):
    def filename(self, name: str | None) -> str: ...
    def mime_type(self, value: str | None) -> str: ...


class AttachmentRepository(Protocol):
    async def replace_for_message(
        self,
        *,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        message_id: uuid.UUID,
        provider_message_id: str,
        attachments: builtins.list[NormalizedAttachment],
    ) -> None: ...
    async def list_for_messages(
        self, user_id: uuid.UUID, message_ids: builtins.list[uuid.UUID]
    ) -> dict[uuid.UUID, builtins.list[Attachment]]: ...
    async def get(self, user_id: uuid.UUID, attachment_id: uuid.UUID) -> Attachment | None: ...
    async def relocate(
        self, user_id: uuid.UUID, account_id: uuid.UUID, old_id: str, new_id: str
    ) -> None: ...


class AttachmentService:
    def __init__(
        self,
        repository: AttachmentRepository,
        sessions: ProviderSessionFactory,
        normalizer: AttachmentNormalizer,
        max_bytes: int,
    ) -> None:
        self._repo = repository
        self._sessions = sessions
        self._normalizer = normalizer
        self._max_bytes = max_bytes

    async def index(
        self,
        *,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        message_id: uuid.UUID,
        provider_message_id: str,
        attachments: tuple[ProviderAttachment, ...],
    ) -> None:
        """Store metadata for a message's attachments, with names and types made safe."""
        normalized = [
            NormalizedAttachment(
                part_id=a.part_id[:64],
                filename=self._normalizer.filename(a.filename),
                mime_type=self._normalizer.mime_type(a.mime_type),
                size=max(0, a.size),
                content_id=a.content_id[:255] if a.content_id else None,
                is_inline=a.is_inline,
            )
            for a in attachments
        ]
        await self._repo.replace_for_message(
            user_id=user_id,
            account_id=account_id,
            message_id=message_id,
            provider_message_id=provider_message_id,
            attachments=normalized,
        )

    async def relocate(
        self, user_id: uuid.UUID, account_id: uuid.UUID, old_id: str, new_id: str
    ) -> None:
        """Follow a message whose provider id changed, so downloads keep working."""
        await self._repo.relocate(user_id, account_id, old_id, new_id)

    async def list_for_messages(
        self, user_id: uuid.UUID, message_ids: builtins.list[uuid.UUID]
    ) -> dict[uuid.UUID, builtins.list[Attachment]]:
        if not message_ids:
            return {}
        return await self._repo.list_for_messages(user_id, message_ids)

    async def get(self, user_id: uuid.UUID, attachment_id: uuid.UUID) -> Attachment:
        attachment = await self._repo.get(user_id, attachment_id)
        if attachment is None:
            raise NotFoundError
        return attachment

    async def download(
        self, user_id: uuid.UUID, attachment_id: uuid.UUID
    ) -> tuple[Attachment, bytes]:
        attachment = await self.get(user_id, attachment_id)
        if attachment.size > self._max_bytes:
            raise PayloadTooLargeError("This attachment is too large to download here.")
        async with self._sessions.open(user_id, attachment.account_id) as session:
            content = await session.provider.get_attachment(
                attachment.provider_message_id, attachment.part_id
            )
        return attachment, content
