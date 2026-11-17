"""Minimal security audit trail. Stores event type and coarse context, never content."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from sqlalchemy import String, update
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database.base import Base, created_at_column, uuid_pk
from app.core.logging import get_logger

logger = get_logger(__name__)


class AuditEventModel(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = uuid_pk()
    # No foreign key on purpose: events are written in their own transaction (so failures
    # such as rejected logins are still recorded) and are detached when the user is deleted.
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    event_metadata: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = created_at_column()


class SqlAuditLog:
    def __init__(self, factory: async_sessionmaker[AsyncSession]) -> None:
        self._factory = factory

    async def record(
        self,
        event_type: str,
        *,
        user_id: uuid.UUID | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        metadata: Mapping[str, str | int | bool | None] | None = None,
    ) -> None:
        try:
            async with self._factory() as session, session.begin():
                session.add(
                    AuditEventModel(
                        user_id=user_id,
                        event_type=event_type,
                        ip_address=ip_address,
                        user_agent=user_agent,
                        event_metadata=dict(metadata) if metadata else None,
                    )
                )
        except Exception as exc:  # auditing must never break the audited operation
            logger.error("audit_write_failed", audit_event=event_type, error=type(exc).__name__)

    async def forget_user(self, user_id: uuid.UUID) -> None:
        async with self._factory() as session, session.begin():
            await session.execute(
                update(AuditEventModel)
                .where(AuditEventModel.user_id == user_id)
                .values(user_id=None, ip_address=None, user_agent=None)
            )
