from __future__ import annotations

import builtins
import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text, delete, func, select, update
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database.base import Base, created_at_column, updated_at_column, uuid_pk
from app.modules.templates.domain import Template, TemplateContent


class MessageTemplateModel(Base):
    __tablename__ = "message_templates"
    __table_args__ = (Index("ix_message_templates_user_id_name", "user_id", "name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False, default="")
    body_html: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


T = MessageTemplateModel


def _template(row: MessageTemplateModel) -> Template:
    return Template(
        id=row.id,
        name=row.name,
        subject=row.subject,
        body_html=row.body_html,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class SqlTemplateRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def list(self, user_id: uuid.UUID) -> builtins.list[Template]:
        rows = await self._db.scalars(
            select(T).where(T.user_id == user_id).order_by(func.lower(T.name), T.id)
        )
        return [_template(r) for r in rows]

    async def get(self, user_id: uuid.UUID, template_id: uuid.UUID) -> Template | None:
        row = await self._db.scalar(select(T).where(T.user_id == user_id, T.id == template_id))
        return _template(row) if row else None

    async def count(self, user_id: uuid.UUID) -> int:
        return int(await self._db.scalar(select(func.count()).where(T.user_id == user_id)) or 0)

    async def create(self, user_id: uuid.UUID, content: TemplateContent) -> Template:
        row = MessageTemplateModel(
            user_id=user_id,
            name=content.name,
            subject=content.subject,
            body_html=content.body_html,
        )
        self._db.add(row)
        await self._db.flush()
        await self._db.refresh(row)
        return _template(row)

    async def update(
        self, user_id: uuid.UUID, template_id: uuid.UUID, content: TemplateContent
    ) -> Template | None:
        row = await self._db.scalar(
            update(T)
            .where(T.user_id == user_id, T.id == template_id)
            .values(
                name=content.name,
                subject=content.subject,
                body_html=content.body_html,
                updated_at=func.now(),
            )
            .returning(T)
            .execution_options(populate_existing=True)
        )
        return _template(row) if row else None

    async def delete(self, user_id: uuid.UUID, template_id: uuid.UUID) -> bool:
        result = await self._db.execute(
            delete(T).where(T.user_id == user_id, T.id == template_id).returning(T.id)
        )
        return result.scalar_one_or_none() is not None
