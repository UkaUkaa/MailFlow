from __future__ import annotations

import builtins
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import UUID, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database.base import Base, updated_at_column, uuid_pk
from app.modules.synchronization.domain import SyncState, SyncStatus


class SyncStateModel(Base):
    __tablename__ = "sync_states"
    __table_args__ = (
        ForeignKeyConstraint(
            ["account_id", "user_id"],
            ["email_accounts.id", "email_accounts.user_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("account_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="idle")
    cursor: Mapped[str | None] = mapped_column(Text)
    backfill_page_token: Mapped[str | None] = mapped_column(Text)
    backfill_complete: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    initial_sync_complete: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    messages_synced: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    consecutive_failures: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_code: Mapped[str | None] = mapped_column(String(64))
    next_sync_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()"), index=True
    )
    updated_at: Mapped[datetime] = updated_at_column()


def _state(row: SyncStateModel) -> SyncState:
    return SyncState(
        account_id=row.account_id,
        status=SyncStatus(row.status),
        cursor=row.cursor,
        backfill_page_token=row.backfill_page_token,
        backfill_complete=row.backfill_complete,
        initial_sync_complete=row.initial_sync_complete,
        messages_synced=row.messages_synced,
        consecutive_failures=row.consecutive_failures,
        last_synced_at=row.last_synced_at,
        last_started_at=row.last_started_at,
        last_error_code=row.last_error_code,
        next_sync_at=row.next_sync_at,
    )


class SqlSyncStateRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def get(self, user_id: uuid.UUID, account_id: uuid.UUID) -> SyncState | None:
        row = await self._db.scalar(
            select(SyncStateModel)
            .where(SyncStateModel.user_id == user_id, SyncStateModel.account_id == account_id)
            .execution_options(populate_existing=True)
        )
        return _state(row) if row else None

    async def list(self, user_id: uuid.UUID) -> builtins.list[SyncState]:
        rows = await self._db.scalars(
            select(SyncStateModel)
            .where(SyncStateModel.user_id == user_id)
            .execution_options(populate_existing=True)
        )
        return [_state(r) for r in rows]

    async def save(self, user_id: uuid.UUID, state: SyncState) -> None:
        values = {
            "status": state.status.value,
            "cursor": state.cursor,
            "backfill_page_token": state.backfill_page_token,
            "backfill_complete": state.backfill_complete,
            "initial_sync_complete": state.initial_sync_complete,
            "messages_synced": state.messages_synced,
            "consecutive_failures": state.consecutive_failures,
            "last_synced_at": state.last_synced_at,
            "last_started_at": state.last_started_at,
            "last_error_code": state.last_error_code,
        }
        if state.next_sync_at is not None:
            values["next_sync_at"] = state.next_sync_at
        stmt = insert(SyncStateModel).values(
            id=uuid.uuid4(), user_id=user_id, account_id=state.account_id, **values
        )
        await self._db.execute(
            stmt.on_conflict_do_update(
                index_elements=["account_id"],
                set_=values,
                where=SyncStateModel.user_id == user_id,
            )
        )
