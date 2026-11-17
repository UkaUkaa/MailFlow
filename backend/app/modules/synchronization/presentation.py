from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, status
from pydantic import BaseModel

from app.api.deps import Auth, Svc

router = APIRouter(prefix="/sync", tags=["sync"])


class Queued(BaseModel):
    status: str = "queued"


class QueuedMany(BaseModel):
    queued: int


class SyncStatusOut(BaseModel):
    account_id: uuid.UUID
    status: str
    last_synced_at: datetime | None
    last_error_code: str | None
    initial_sync_complete: bool


class SyncStatusList(BaseModel):
    items: list[SyncStatusOut]


@router.post("/accounts/{account_id}", status_code=status.HTTP_202_ACCEPTED, response_model=Queued)
async def sync_account(account_id: uuid.UUID, auth: Auth, svc: Svc) -> Queued:
    await svc.sync_requests.request(auth.user_id, account_id, throttle=True)
    return Queued()


@router.post("/all", status_code=status.HTTP_202_ACCEPTED, response_model=QueuedMany)
async def sync_all(auth: Auth, svc: Svc) -> QueuedMany:
    accounts = [a.id for a in await svc.accounts.list(auth.user_id) if a.is_active]
    return QueuedMany(queued=await svc.sync_requests.request_all(auth.user_id, accounts))


@router.get("/status", response_model=SyncStatusList)
async def sync_status(auth: Auth, svc: Svc) -> SyncStatusList:
    accounts = await svc.accounts.list(auth.user_id)
    states = await svc.sync_requests.status(auth.user_id)
    items = []
    for account in accounts:
        state = states.get(account.id)
        items.append(
            SyncStatusOut(
                account_id=account.id,
                status=state.status.value if state else "idle",
                last_synced_at=state.last_synced_at if state else None,
                last_error_code=state.last_error_code if state else None,
                initial_sync_complete=state.initial_sync_complete if state else False,
            )
        )
    return SyncStatusList(items=items)
