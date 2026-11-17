from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import Auth, Svc
from app.api.schemas import ThreadListOut, thread_out
from app.core.dependencies import rate_limit

router = APIRouter(prefix="/search", tags=["search"])


@router.get(
    "",
    response_model=ThreadListOut,
    dependencies=[Depends(rate_limit("search", limit=120, window_seconds=60))],
)
async def search(
    auth: Auth,
    svc: Svc,
    q: Annotated[str, Query(min_length=1, max_length=200)],
    account_id: uuid.UUID | None = None,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
) -> ThreadListOut:
    """Full-text search over the caller's synchronized mail only."""
    if account_id is not None:
        await svc.accounts.get(auth.user_id, account_id)
    page = await svc.thread_queries.search(
        auth.user_id, query=q, account_id=account_id, cursor=cursor, limit=limit
    )
    return ThreadListOut(items=[thread_out(t) for t in page.items], next_cursor=page.next_cursor)
