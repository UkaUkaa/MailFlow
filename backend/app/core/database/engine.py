"""Engine / session factory construction and tenant context handling."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import Settings


def create_engine(settings: Settings, *, pooled: bool = True) -> AsyncEngine:
    """Create the application engine (restricted role, subject to RLS).

    Workers pass ``pooled=False`` because each task runs in its own event loop.
    """
    if not pooled:
        return create_async_engine(settings.database_url, poolclass=NullPool)
    return create_async_engine(
        settings.database_url,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_pre_ping=True,
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


async def set_tenant(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Bind the current transaction to a tenant.

    ``set_config(..., true)`` is transaction-local: the value is discarded at COMMIT/ROLLBACK,
    so it can never leak to another request through the connection pool.
    """
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"), {"uid": str(user_id)}
    )


@asynccontextmanager
async def tenant_transaction(
    factory: async_sessionmaker[AsyncSession], user_id: uuid.UUID
) -> AsyncIterator[AsyncSession]:
    """One transaction scoped to ``user_id``; commits on success, rolls back on error."""
    async with factory() as session, session.begin():
        await set_tenant(session, user_id)
        yield session


@asynccontextmanager
async def system_transaction(
    factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """Transaction without tenant context: only non-RLS tables and SECURITY DEFINER functions."""
    async with factory() as session, session.begin():
        yield session
