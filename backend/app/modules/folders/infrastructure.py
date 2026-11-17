from __future__ import annotations

import builtins
import uuid
from datetime import datetime

from sqlalchemy import ForeignKeyConstraint, String, UniqueConstraint, delete, select
from sqlalchemy.dialects.postgresql import UUID, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database.base import Base, created_at_column, uuid_pk
from app.integrations.email_providers.contracts import FolderRole, ProviderFolder
from app.modules.folders.application import Folder


class EmailFolderModel(Base):
    __tablename__ = "email_folders"
    __table_args__ = (
        ForeignKeyConstraint(
            ["account_id", "user_id"],
            ["email_accounts.id", "email_accounts.user_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("account_id", "provider_folder_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    provider_folder_id: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = created_at_column()


def _folder(row: EmailFolderModel) -> Folder:
    return Folder(row.id, row.account_id, row.provider_folder_id, FolderRole(row.role), row.name)


class SqlFolderRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def list(self, user_id: uuid.UUID, account_id: uuid.UUID | None) -> builtins.list[Folder]:
        stmt = select(EmailFolderModel).where(EmailFolderModel.user_id == user_id)
        if account_id is not None:
            stmt = stmt.where(EmailFolderModel.account_id == account_id)
        rows = await self._db.scalars(stmt.order_by(EmailFolderModel.name))
        return [_folder(r) for r in rows]

    async def get(self, user_id: uuid.UUID, folder_id: uuid.UUID) -> Folder | None:
        row = await self._db.scalar(
            select(EmailFolderModel).where(
                EmailFolderModel.id == folder_id, EmailFolderModel.user_id == user_id
            )
        )
        return _folder(row) if row else None

    async def replace_for_account(
        self, user_id: uuid.UUID, account_id: uuid.UUID, folders: builtins.list[ProviderFolder]
    ) -> None:
        keep = [f.provider_folder_id for f in folders]
        scope = (EmailFolderModel.user_id == user_id, EmailFolderModel.account_id == account_id)
        stale = delete(EmailFolderModel).where(*scope)
        if keep:
            stale = stale.where(EmailFolderModel.provider_folder_id.not_in(keep))
        await self._db.execute(stale)
        for folder in folders:
            stmt = insert(EmailFolderModel).values(
                id=uuid.uuid4(),
                user_id=user_id,
                account_id=account_id,
                provider_folder_id=folder.provider_folder_id,
                role=folder.role.value,
                name=folder.name,
            )
            await self._db.execute(
                stmt.on_conflict_do_update(
                    index_elements=["account_id", "provider_folder_id"],
                    set_={"name": folder.name, "role": folder.role.value},
                    where=EmailFolderModel.user_id == user_id,
                )
            )
