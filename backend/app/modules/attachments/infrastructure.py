from __future__ import annotations

import builtins
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    delete,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database.base import Base, created_at_column, uuid_pk
from app.core.security.filenames import normalize_mime_type, sanitize_filename
from app.modules.attachments.application import Attachment, NormalizedAttachment


class AttachmentModel(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["account_id", "user_id"],
            ["email_accounts.id", "email_accounts.user_id"],
            ondelete="CASCADE",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("email_messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider_message_id: Mapped[str] = mapped_column(String(255), nullable=False)
    part_id: Mapped[str] = mapped_column(String(64), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    content_id: Mapped[str | None] = mapped_column(String(255))
    is_inline: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = created_at_column()


def _attachment(row: AttachmentModel) -> Attachment:
    return Attachment(
        id=row.id,
        account_id=row.account_id,
        message_id=row.message_id,
        provider_message_id=row.provider_message_id,
        part_id=row.part_id,
        filename=row.filename,
        mime_type=row.mime_type,
        size=row.size,
        is_inline=row.is_inline,
    )


class SafeAttachmentNormalizer:
    def filename(self, name: str | None) -> str:
        return sanitize_filename(name)

    def mime_type(self, value: str | None) -> str:
        return normalize_mime_type(value)


class SqlAttachmentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def replace_for_message(
        self,
        *,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        message_id: uuid.UUID,
        provider_message_id: str,
        attachments: builtins.list[NormalizedAttachment],
    ) -> None:
        existing = {
            row.part_id: row
            for row in await self._db.scalars(
                select(AttachmentModel).where(
                    AttachmentModel.user_id == user_id, AttachmentModel.message_id == message_id
                )
            )
        }
        wanted = {a.part_id for a in attachments}
        stale = [row.id for part, row in existing.items() if part not in wanted]
        if stale:
            await self._db.execute(
                delete(AttachmentModel).where(
                    AttachmentModel.user_id == user_id, AttachmentModel.id.in_(stale)
                )
            )
        for item in attachments:
            row = existing.get(item.part_id)
            if row is None:
                # Ids of unchanged attachments stay stable across re-synchronization.
                self._db.add(
                    AttachmentModel(
                        user_id=user_id,
                        account_id=account_id,
                        message_id=message_id,
                        provider_message_id=provider_message_id,
                        part_id=item.part_id,
                        filename=item.filename,
                        mime_type=item.mime_type,
                        size=item.size,
                        content_id=item.content_id,
                        is_inline=item.is_inline,
                    )
                )
            else:
                row.provider_message_id = provider_message_id
                row.filename = item.filename
                row.mime_type = item.mime_type
                row.size = item.size
                row.content_id = item.content_id
                row.is_inline = item.is_inline
        await self._db.flush()

    async def relocate(
        self, user_id: uuid.UUID, account_id: uuid.UUID, old_id: str, new_id: str
    ) -> None:
        await self._db.execute(
            update(AttachmentModel)
            .where(
                AttachmentModel.user_id == user_id,
                AttachmentModel.account_id == account_id,
                AttachmentModel.provider_message_id == old_id,
            )
            .values(provider_message_id=new_id)
        )

    async def list_for_messages(
        self, user_id: uuid.UUID, message_ids: builtins.list[uuid.UUID]
    ) -> dict[uuid.UUID, builtins.list[Attachment]]:
        rows = await self._db.scalars(
            select(AttachmentModel)
            .where(AttachmentModel.user_id == user_id, AttachmentModel.message_id.in_(message_ids))
            .order_by(AttachmentModel.part_id)
        )
        result: dict[uuid.UUID, builtins.list[Attachment]] = {}
        for row in rows:
            result.setdefault(row.message_id, []).append(_attachment(row))
        return result

    async def get(self, user_id: uuid.UUID, attachment_id: uuid.UUID) -> Attachment | None:
        row = await self._db.scalar(
            select(AttachmentModel).where(
                AttachmentModel.id == attachment_id, AttachmentModel.user_id == user_id
            )
        )
        return _attachment(row) if row else None
