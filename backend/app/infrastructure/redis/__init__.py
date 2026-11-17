"""Redis-backed implementations of the shared ports."""

from __future__ import annotations

import asyncio
import secrets
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from redis.asyncio import Redis

from app.shared.domain.errors import RateLimitedError

_RELEASE = """
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end
"""
_HIT = """
local c = redis.call('incr', KEYS[1])
if c == 1 then redis.call('expire', KEYS[1], ARGV[1]) end
return {c, redis.call('ttl', KEYS[1])}
"""


def create_redis(url: str) -> Redis:
    return Redis.from_url(url, decode_responses=True, socket_timeout=5, socket_connect_timeout=5)


def user_prefix(user_id: uuid.UUID) -> str:
    return f"mf:u:{user_id}:"


class RedisRateLimiter:
    """Fixed-window counter. Simple, atomic, good enough for abuse throttling."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def hit(self, key: str, *, limit: int, window_seconds: int) -> None:
        count, ttl = await self._redis.eval(_HIT, 1, f"mf:rl:{key}", window_seconds)
        if int(count) > limit:
            raise RateLimitedError(retry_after=int(ttl) if int(ttl) > 0 else window_seconds)


class RedisLock:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    @asynccontextmanager
    async def acquire(
        self, key: str, *, ttl_seconds: int, wait_seconds: float = 0
    ) -> AsyncIterator[bool]:
        token = secrets.token_hex(16)
        name = f"{key}:lock" if key.startswith("mf:") else f"mf:lock:{key}"
        deadline = asyncio.get_running_loop().time() + wait_seconds
        acquired = False
        while True:
            acquired = bool(await self._redis.set(name, token, nx=True, ex=ttl_seconds))
            if acquired or asyncio.get_running_loop().time() >= deadline:
                break
            await asyncio.sleep(0.1)
        try:
            yield acquired
        finally:
            if acquired:
                await self._redis.eval(_RELEASE, 1, name, token)


class RedisIdempotencyStore:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def begin(self, key: str, *, ttl_seconds: int) -> str | None:
        if await self._redis.set(key, "", nx=True, ex=ttl_seconds):
            return None
        return str(await self._redis.get(key) or "")

    async def complete(self, key: str, result: str, *, ttl_seconds: int) -> None:
        await self._redis.set(key, result, ex=ttl_seconds)

    async def release(self, key: str) -> None:
        await self._redis.delete(key)


class RedisTenantCache:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def purge_user(self, user_id: uuid.UUID) -> None:
        batch: list[str] = []
        async for key in self._redis.scan_iter(match=f"{user_prefix(user_id)}*", count=500):
            batch.append(key)
            if len(batch) >= 500:
                await self._redis.delete(*batch)
                batch.clear()
        if batch:
            await self._redis.delete(*batch)
