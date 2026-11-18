from __future__ import annotations

import uuid
from dataclasses import fields
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, SmallInteger, String, select, text
from sqlalchemy.dialects.postgresql import UUID, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database.base import Base, updated_at_column
from app.modules.settings.domain import UserSettings


class UserSettingsModel(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="en")
    theme: Mapped[str] = mapped_column(String(16), nullable=False, default="system")
    # Default flipped to on in migration 0005 (docs/DECISIONS.md).
    load_remote_images: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    conversation_view: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Interface preferences (migration 0003). Server defaults fill rows written before them.
    list_density: Mapped[str] = mapped_column(
        String(16), nullable=False, default="comfortable", server_default="comfortable"
    )
    list_preview_lines: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=1, server_default=text("1")
    )
    show_avatars: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    account_tint: Mapped[str] = mapped_column(
        String(16), nullable=False, default="subtle", server_default="subtle"
    )
    accent_color: Mapped[str] = mapped_column(
        String(16), nullable=False, default="blue", server_default="blue"
    )
    reader_text_size: Mapped[str] = mapped_column(
        String(16), nullable=False, default="default", server_default="default"
    )
    updated_at: Mapped[datetime] = updated_at_column()


_FIELDS = tuple(field.name for field in fields(UserSettings))


class SqlSettingsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def get(self, user_id: uuid.UUID) -> UserSettings | None:
        row = await self._db.scalar(
            select(UserSettingsModel).where(UserSettingsModel.user_id == user_id)
        )
        if row is None:
            return None
        return UserSettings(**{field: getattr(row, field) for field in _FIELDS})

    async def save(self, user_id: uuid.UUID, settings: UserSettings) -> None:
        values = {field: getattr(settings, field) for field in _FIELDS}
        stmt = insert(UserSettingsModel).values(user_id=user_id, **values)
        await self._db.execute(stmt.on_conflict_do_update(index_elements=["user_id"], set_=values))
