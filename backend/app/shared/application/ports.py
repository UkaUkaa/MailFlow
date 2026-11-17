"""Cross-cutting ports used by several modules. Implementations live in infrastructure."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from contextlib import AbstractAsyncContextManager
from datetime import UTC, datetime
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class RateLimiter(Protocol):
    async def hit(self, key: str, *, limit: int, window_seconds: int) -> None:
        """Record one attempt; raise ``RateLimitedError`` when the limit is exceeded."""


class DistributedLock(Protocol):
    def acquire(
        self, key: str, *, ttl_seconds: int, wait_seconds: float = 0
    ) -> AbstractAsyncContextManager[bool]:
        """Async context manager yielding True when the lock was obtained."""


class IdempotencyStore(Protocol):
    async def begin(self, key: str, *, ttl_seconds: int) -> str | None:
        """Reserve ``key``. Returns None when reserved now, the stored result ("" while the
        first request is still running) when the key was seen before."""

    async def complete(self, key: str, result: str, *, ttl_seconds: int) -> None: ...

    async def release(self, key: str) -> None: ...


class AuditLog(Protocol):
    async def record(
        self,
        event_type: str,
        *,
        user_id: uuid.UUID | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        metadata: Mapping[str, str | int | bool | None] | None = None,
    ) -> None: ...

    async def forget_user(self, user_id: uuid.UUID) -> None:
        """Detach every stored event from the user (called on account deletion)."""


class TenantCache(Protocol):
    async def purge_user(self, user_id: uuid.UUID) -> None:
        """Remove every cache entry, lock and counter stored under the user's key prefix."""
