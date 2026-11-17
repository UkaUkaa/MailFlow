from __future__ import annotations

import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import Auth, Svc
from app.integrations.email_providers.contracts import FolderRole

router = APIRouter(prefix="/folders", tags=["folders"])


class FolderOut(BaseModel):
    id: uuid.UUID
    account_id: uuid.UUID
    role: str
    name: str
    unread_count: int


class FolderList(BaseModel):
    items: list[FolderOut]


class RoleCount(BaseModel):
    role: str
    unread_count: int


class RoleCountList(BaseModel):
    items: list[RoleCount]


@router.get("", response_model=FolderList)
async def list_folders(auth: Auth, svc: Svc, account_id: uuid.UUID | None = None) -> FolderList:
    if account_id is not None:
        await svc.accounts.get(auth.user_id, account_id)  # 404 for foreign accounts
    folders = await svc.folders.list(auth.user_id, account_id)
    counts: dict[uuid.UUID, dict[FolderRole, int]] = {}
    items = []
    for folder in folders:
        if folder.role is FolderRole.CUSTOM:
            unread = 0
        else:
            if folder.account_id not in counts:
                counts[folder.account_id] = await svc.thread_queries.unread_counts(
                    auth.user_id, folder.account_id
                )
            unread = counts[folder.account_id].get(folder.role, 0)
        items.append(
            FolderOut(
                id=folder.id,
                account_id=folder.account_id,
                role=folder.role.value,
                name=folder.name,
                unread_count=unread,
            )
        )
    return FolderList(items=items)


@router.get("/counts", response_model=RoleCountList)
async def folder_counts(auth: Auth, svc: Svc, account_id: uuid.UUID | None = None) -> RoleCountList:
    if account_id is not None:
        await svc.accounts.get(auth.user_id, account_id)
    counts = await svc.thread_queries.unread_counts(auth.user_id, account_id)
    return RoleCountList(
        items=[RoleCount(role=role.value, unread_count=count) for role, count in counts.items()]
    )
