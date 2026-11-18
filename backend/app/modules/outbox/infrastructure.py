from __future__ import annotations

import builtins
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    and_,
    delete,
    func,
    or_,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database.base import Base, created_at_column, updated_at_column, uuid_pk
from app.integrations.email_providers.contracts import Address, SendMode
from app.modules.outbox.domain import (
    OutboxContent,
    OutboxFile,
    OutboxFileMeta,
    OutboxItem,
    OutboxKind,
    OutboxStatus,
)

_ACTIVE = (OutboxStatus.PENDING.value, OutboxStatus.SENDING.value)


class OutboxItemModel(Base):
    __tablename__ = "outbox_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["account_id", "user_id"],
            ["email_accounts.id", "email_accounts.user_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("user_id", "idempotency_key"),
        # The beat scan: due work in time order, nothing else.
        Index(
            "ix_outbox_items_due",
            "next_attempt_at",
            postgresql_where=text("status IN ('pending', 'sending')"),
        ),
        Index("ix_outbox_items_user_id_send_at", "user_id", "send_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    # When the user wants it sent. ``next_attempt_at`` is when a worker may next try, which
    # moves forward on retries without changing what the user sees.
    send_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Lease of the worker that is sending; an expired lease lets the item be claimed again.
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when a task for the item is on the broker, so the beat scan does not enqueue twice.
    enqueued_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="new")
    recipients: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False, default="")
    snippet: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    body_html: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    draft_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    forward_attachment_ids: Mapped[builtins.list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    error_code: Mapped[str | None] = mapped_column(String(64))
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    thread_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class OutboxAttachmentModel(Base):
    __tablename__ = "outbox_attachments"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    outbox_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("outbox_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)


def _addresses(values: tuple[Address, ...]) -> builtins.list[dict[str, str | None]]:
    return [{"email": a.email, "name": a.name} for a in values]


def _to_addresses(values: object) -> tuple[Address, ...]:
    if not isinstance(values, list):
        return ()
    return tuple(Address(email=str(v["email"]), name=v.get("name") or None) for v in values)


class SqlOutboxRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def _to_domain(self, row: OutboxItemModel) -> OutboxItem:
        files = await self._db.execute(
            select(
                OutboxAttachmentModel.filename,
                OutboxAttachmentModel.mime_type,
                OutboxAttachmentModel.size,
            )
            .where(
                OutboxAttachmentModel.user_id == row.user_id,
                OutboxAttachmentModel.outbox_id == row.id,
            )
            .order_by(OutboxAttachmentModel.position)
        )
        return OutboxItem(
            id=row.id,
            user_id=row.user_id,
            account_id=row.account_id,
            kind=OutboxKind(row.kind),
            status=OutboxStatus(row.status),
            send_at=row.send_at,
            idempotency_key=row.idempotency_key,
            content=OutboxContent(
                to=_to_addresses(row.recipients.get("to")),
                cc=_to_addresses(row.recipients.get("cc")),
                bcc=_to_addresses(row.recipients.get("bcc")),
                subject=row.subject,
                body_html=row.body_html,
                mode=SendMode(row.mode),
                source_message_id=row.source_message_id,
                draft_id=row.draft_id,
                forward_attachment_ids=tuple(uuid.UUID(v) for v in row.forward_attachment_ids),
            ),
            snippet=row.snippet,
            created_at=row.created_at,
            attachments=tuple(OutboxFileMeta(f, m, s) for f, m, s in files.all()),
            attempts=row.attempts,
            error_code=row.error_code,
            message_id=row.message_id,
            thread_id=row.thread_id,
        )

    async def insert(
        self,
        item: OutboxItem,
        files: builtins.list[OutboxFile],
        *,
        enqueued_until: datetime | None,
    ) -> bool:
        content = item.content
        stmt = (
            insert(OutboxItemModel)
            .values(
                id=item.id,
                user_id=item.user_id,
                account_id=item.account_id,
                kind=item.kind.value,
                status=item.status.value,
                send_at=item.send_at,
                next_attempt_at=item.send_at,
                enqueued_until=enqueued_until,
                idempotency_key=item.idempotency_key,
                mode=content.mode.value,
                recipients={
                    "to": _addresses(content.to),
                    "cc": _addresses(content.cc),
                    "bcc": _addresses(content.bcc),
                },
                subject=content.subject,
                snippet=item.snippet,
                body_html=content.body_html,
                source_message_id=content.source_message_id,
                draft_id=content.draft_id,
                forward_attachment_ids=[str(v) for v in content.forward_attachment_ids],
                created_at=item.created_at,
            )
            .on_conflict_do_nothing(index_elements=["user_id", "idempotency_key"])
            .returning(OutboxItemModel.id)
        )
        if await self._db.scalar(stmt) is None:
            return False
        for position, file in enumerate(files):
            self._db.add(
                OutboxAttachmentModel(
                    user_id=item.user_id,
                    outbox_id=item.id,
                    position=position,
                    filename=file.filename[:255],
                    mime_type=file.mime_type[:255],
                    size=len(file.content),
                    content=file.content,
                )
            )
        await self._db.flush()
        return True

    async def get(
        self, user_id: uuid.UUID, outbox_id: uuid.UUID, *, for_update: bool = False
    ) -> OutboxItem | None:
        stmt = select(OutboxItemModel).where(
            OutboxItemModel.user_id == user_id, OutboxItemModel.id == outbox_id
        )
        if for_update:
            stmt = stmt.with_for_update()
        row = await self._db.scalar(stmt.execution_options(populate_existing=True))
        return await self._to_domain(row) if row else None

    async def get_by_key(self, user_id: uuid.UUID, idempotency_key: str) -> OutboxItem | None:
        row = await self._db.scalar(
            select(OutboxItemModel).where(
                OutboxItemModel.user_id == user_id,
                OutboxItemModel.idempotency_key == idempotency_key,
            )
        )
        return await self._to_domain(row) if row else None

    async def list_visible(
        self, user_id: uuid.UUID, *, overdue_before: datetime
    ) -> builtins.list[OutboxItem]:
        rows = await self._db.scalars(
            select(OutboxItemModel)
            .where(
                OutboxItemModel.user_id == user_id,
                or_(
                    OutboxItemModel.status == OutboxStatus.FAILED.value,
                    and_(
                        OutboxItemModel.status.in_(_ACTIVE),
                        or_(
                            OutboxItemModel.kind == OutboxKind.SCHEDULED.value,
                            OutboxItemModel.send_at < overdue_before,
                        ),
                    ),
                ),
            )
            .order_by(OutboxItemModel.send_at, OutboxItemModel.id)
            .execution_options(populate_existing=True)
        )
        return [await self._to_domain(row) for row in rows.all()]

    async def count_active(self, user_id: uuid.UUID) -> int:
        count = await self._db.scalar(
            select(func.count())
            .select_from(OutboxItemModel)
            .where(OutboxItemModel.user_id == user_id, OutboxItemModel.status.in_(_ACTIVE))
        )
        return int(count or 0)

    async def files(self, user_id: uuid.UUID, outbox_id: uuid.UUID) -> builtins.list[OutboxFile]:
        rows = await self._db.scalars(
            select(OutboxAttachmentModel)
            .where(
                OutboxAttachmentModel.user_id == user_id,
                OutboxAttachmentModel.outbox_id == outbox_id,
            )
            .order_by(OutboxAttachmentModel.position)
        )
        return [OutboxFile(r.filename, r.mime_type, r.content) for r in rows.all()]

    async def _set(self, user_id: uuid.UUID, outbox_id: uuid.UUID, **values: object) -> None:
        await self._db.execute(
            update(OutboxItemModel)
            .where(OutboxItemModel.user_id == user_id, OutboxItemModel.id == outbox_id)
            .values(**values)
        )

    async def _erase_content(self, user_id: uuid.UUID, outbox_id: uuid.UUID) -> None:
        """A finished item keeps its row (idempotent replays) but not the mail it carried."""
        await self._db.execute(
            delete(OutboxAttachmentModel).where(
                OutboxAttachmentModel.user_id == user_id,
                OutboxAttachmentModel.outbox_id == outbox_id,
            )
        )
        await self._set(user_id, outbox_id, body_html="", snippet="")

    async def reschedule(
        self,
        user_id: uuid.UUID,
        outbox_id: uuid.UUID,
        *,
        send_at: datetime,
        enqueued_until: datetime | None,
    ) -> None:
        await self._set(
            user_id,
            outbox_id,
            kind=OutboxKind.SCHEDULED.value,
            status=OutboxStatus.PENDING.value,
            send_at=send_at,
            next_attempt_at=send_at,
            enqueued_until=enqueued_until,
            locked_until=None,
            attempts=0,
            error_code=None,
        )

    async def claim(
        self, user_id: uuid.UUID, outbox_id: uuid.UUID, *, now: datetime, locked_until: datetime
    ) -> OutboxItem | None:
        # One UPDATE: under READ COMMITTED a second claimer waits for the first to commit and
        # then re-checks the predicate against the new row, which no longer matches.
        row = await self._db.scalar(
            update(OutboxItemModel)
            .where(
                OutboxItemModel.user_id == user_id,
                OutboxItemModel.id == outbox_id,
                or_(
                    and_(
                        OutboxItemModel.status == OutboxStatus.PENDING.value,
                        OutboxItemModel.next_attempt_at <= now,
                    ),
                    and_(
                        OutboxItemModel.status == OutboxStatus.SENDING.value,
                        OutboxItemModel.locked_until <= now,
                    ),
                ),
            )
            .values(
                status=OutboxStatus.SENDING.value,
                attempts=OutboxItemModel.attempts + 1,
                locked_until=locked_until,
            )
            .returning(OutboxItemModel)
            .execution_options(populate_existing=True)
        )
        return await self._to_domain(row) if row else None

    async def mark_sent(
        self,
        user_id: uuid.UUID,
        outbox_id: uuid.UUID,
        *,
        message_id: uuid.UUID | None,
        thread_id: uuid.UUID | None,
        now: datetime,
    ) -> None:
        await self._set(
            user_id,
            outbox_id,
            status=OutboxStatus.SENT.value,
            message_id=message_id,
            thread_id=thread_id,
            sent_at=now,
            locked_until=None,
            error_code=None,
        )
        await self._erase_content(user_id, outbox_id)

    async def mark_cancelled(self, user_id: uuid.UUID, outbox_id: uuid.UUID) -> None:
        await self._set(user_id, outbox_id, status=OutboxStatus.CANCELLED.value, locked_until=None)
        await self._erase_content(user_id, outbox_id)

    async def mark_failed(self, user_id: uuid.UUID, outbox_id: uuid.UUID, error_code: str) -> None:
        await self._set(
            user_id,
            outbox_id,
            status=OutboxStatus.FAILED.value,
            error_code=error_code[:64],
            locked_until=None,
        )

    async def retry_later(
        self,
        user_id: uuid.UUID,
        outbox_id: uuid.UUID,
        *,
        next_attempt_at: datetime,
        error_code: str,
    ) -> None:
        await self._set(
            user_id,
            outbox_id,
            status=OutboxStatus.PENDING.value,
            next_attempt_at=next_attempt_at,
            enqueued_until=None,
            locked_until=None,
            error_code=error_code[:64],
        )
