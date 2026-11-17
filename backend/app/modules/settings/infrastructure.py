from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String, select
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
    load_remote_images: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    conversation_view: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = updated_at_column()


class SqlSettingsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def get(self, user_id: uuid.UUID) -> UserSettings | None:
        row = await self._db.scalar(
            select(UserSettingsModel).where(UserSettingsModel.user_id == user_id)
        )
        if row is None:
            return None
        return UserSettings(
            locale=row.locale,
            theme=row.theme,
            load_remote_images=row.load_remote_images,
            conversation_view=row.conversation_view,
        )

    async def save(self, user_id: uuid.UUID, settings: UserSettings) -> None:
        values = {
            "locale": settings.locale,
            "theme": settings.theme,
            "load_remote_images": settings.load_remote_images,
            "conversation_view": settings.conversation_view,
        }
        stmt = insert(UserSettingsModel).values(user_id=user_id, **values)
        await self._db.execute(stmt.on_conflict_do_update(index_elements=["user_id"], set_=values))
