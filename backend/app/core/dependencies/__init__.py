"""Framework-level dependencies shared by every module's presentation layer."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated, cast

from fastapi import Depends, Request
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.infrastructure.redis import RedisIdempotencyStore, RedisLock, RedisRateLimiter
from app.shared.application.ports import Clock, SystemClock

SettingsDep = Annotated[Settings, Depends(get_settings)]


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    """One session and one transaction per request; committed only if the handler succeeds."""
    factory = cast(async_sessionmaker[AsyncSession], request.app.state.session_factory)
    async with factory() as session, session.begin():
        yield session


def get_redis(request: Request) -> Redis:
    return cast(Redis, request.app.state.redis)


DbSession = Annotated[AsyncSession, Depends(get_db)]
RedisDep = Annotated[Redis, Depends(get_redis)]


def get_clock() -> Clock:
    return SystemClock()


def get_rate_limiter(redis: RedisDep) -> RedisRateLimiter:
    return RedisRateLimiter(redis)


def get_lock(redis: RedisDep) -> RedisLock:
    return RedisLock(redis)


def get_idempotency_store(redis: RedisDep) -> RedisIdempotencyStore:
    return RedisIdempotencyStore(redis)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def user_agent(request: Request) -> str | None:
    value = request.headers.get("user-agent")
    return value[:255] if value else None


def rate_limit(
    name: str, *, limit: int, window_seconds: int
) -> Callable[[Request, RedisRateLimiter], Awaitable[None]]:
    """Per-IP limit for an endpoint. Per-identity limits are applied inside use cases."""

    async def dependency(
        request: Request, limiter: Annotated[RedisRateLimiter, Depends(get_rate_limiter)]
    ) -> None:
        await limiter.hit(
            f"{name}:ip:{client_ip(request)}", limit=limit, window_seconds=window_seconds
        )

    return dependency
