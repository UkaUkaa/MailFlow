"""Folders / labels of connected mailboxes."""

from __future__ import annotations

import builtins
import uuid
from dataclasses import dataclass
from typing import Protocol

from app.integrations.email_providers.contracts import FolderRole, ProviderFolder
from app.shared.domain.errors import NotFoundError


@dataclass(frozen=True, slots=True)
class Folder:
    id: uuid.UUID
    account_id: uuid.UUID
    provider_folder_id: str
    role: FolderRole
    name: str


class FolderRepository(Protocol):
    async def list(self, user_id: uuid.UUID, account_id: uuid.UUID | None) -> list[Folder]: ...
    async def get(self, user_id: uuid.UUID, folder_id: uuid.UUID) -> Folder | None: ...
    async def replace_for_account(
        self, user_id: uuid.UUID, account_id: uuid.UUID, folders: builtins.list[ProviderFolder]
    ) -> None: ...


class FolderService:
    def __init__(self, repository: FolderRepository) -> None:
        self._repo = repository

    async def list(self, user_id: uuid.UUID, account_id: uuid.UUID | None = None) -> list[Folder]:
        return await self._repo.list(user_id, account_id)

    async def get(self, user_id: uuid.UUID, folder_id: uuid.UUID) -> Folder:
        folder = await self._repo.get(user_id, folder_id)
        if folder is None:
            raise NotFoundError
        return folder

    async def sync_from_provider(
        self, user_id: uuid.UUID, account_id: uuid.UUID, folders: builtins.list[ProviderFolder]
    ) -> None:
        await self._repo.replace_for_account(user_id, account_id, folders)
