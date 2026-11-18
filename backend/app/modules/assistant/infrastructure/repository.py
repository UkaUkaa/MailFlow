from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, delete, func, select
from sqlalchemy.dialects.postgresql import JSONB, UUID, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database.base import Base, updated_at_column
from app.modules.assistant.domain import AiProvider, AssistantConfig


class AssistantConfigModel(Base):
    """Which AI service the user connected. The key is in ``user_secrets`` (Token Vault)."""

    __tablename__ = "assistant_configs"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    key_hint: Mapped[str] = mapped_column(String(8), nullable=False)
    models: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    updated_at: Mapped[datetime] = updated_at_column()


C = AssistantConfigModel


class SqlAssistantConfigRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def get(self, user_id: uuid.UUID) -> AssistantConfig | None:
        row = await self._db.scalar(
            select(C).where(C.user_id == user_id).execution_options(populate_existing=True)
        )
        if row is None:
            return None
        return AssistantConfig(
            provider=AiProvider(row.provider),
            model=row.model,
            key_hint=row.key_hint,
            models=tuple(row.models),
        )

    async def save(self, user_id: uuid.UUID, config: AssistantConfig) -> None:
        values = {
            "provider": config.provider.value,
            "model": config.model,
            "key_hint": config.key_hint,
            "models": list(config.models),
        }
        stmt = insert(C).values(user_id=user_id, **values)
        await self._db.execute(
            stmt.on_conflict_do_update(
                index_elements=["user_id"], set_={**values, "updated_at": func.now()}
            )
        )

    async def delete(self, user_id: uuid.UUID) -> None:
        await self._db.execute(delete(C).where(C.user_id == user_id))
