"""SQLAlchemy persistence for users."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database.base import Base, created_at_column, updated_at_column, uuid_pk
from app.modules.users.domain import User, UserStatus


class UserModel(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


def _to_domain(row: UserModel) -> User:
    return User(
        id=row.id,
        email=row.email,
        display_name=row.display_name,
        password_hash=row.password_hash,
        status=UserStatus(row.status),
        email_verified_at=row.email_verified_at,
        created_at=row.created_at,
    )


class SqlUserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        row = await self._session.get(UserModel, user_id, populate_existing=True)
        return _to_domain(row) if row else None

    async def get_by_email(self, email: str) -> User | None:
        row = await self._session.scalar(
            select(UserModel)
            .where(UserModel.email == email)
            .execution_options(populate_existing=True)
        )
        return _to_domain(row) if row else None

    async def add(self, *, email: str, display_name: str, password_hash: str) -> User:
        row = UserModel(email=email, display_name=display_name, password_hash=password_hash)
        self._session.add(row)
        await self._session.flush()
        await self._session.refresh(row)
        return _to_domain(row)

    async def _update(self, user_id: uuid.UUID, **values: object) -> None:
        await self._session.execute(
            update(UserModel).where(UserModel.id == user_id).values(**values)
        )

    async def set_password(self, user_id: uuid.UUID, password_hash: str) -> None:
        await self._update(user_id, password_hash=password_hash)

    async def mark_verified(self, user_id: uuid.UUID, at: datetime) -> None:
        await self._update(user_id, email_verified_at=at)

    async def set_display_name(self, user_id: uuid.UUID, display_name: str) -> None:
        await self._update(user_id, display_name=display_name)

    async def set_status(self, user_id: uuid.UUID, status: UserStatus) -> None:
        await self._update(user_id, status=status.value)

    async def delete(self, user_id: uuid.UUID) -> None:
        await self._session.execute(delete(UserModel).where(UserModel.id == user_id))
