"""Mailbox synchronization: request, status, and the worker-side run."""

from __future__ import annotations

import asyncio
import builtins
import uuid
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import timedelta
from typing import Protocol

from app.integrations.email_providers.contracts import (
    EmailProvider,
    ProviderCursorExpired,
    ProviderMessage,
    ProviderNotFound,
)
from app.modules.email_accounts.application.sessions import ProviderSessionFactory
from app.modules.emails.application.ingestion import MessageIngestor
from app.modules.folders.application import FolderService
from app.modules.synchronization.domain import SyncState, SyncStatus
from app.shared.application.ports import Clock, DistributedLock, RateLimiter
from app.shared.domain.errors import (
    DomainError,
    NotFoundError,
    ProviderAuthRequiredError,
    ProviderRateLimitedError,
    UnsupportedError,
)

MAX_BACKOFF = timedelta(hours=1)


class SyncStateRepository(Protocol):
    async def get(self, user_id: uuid.UUID, account_id: uuid.UUID) -> SyncState | None: ...
    async def save(self, user_id: uuid.UUID, state: SyncState) -> None: ...
    async def list(self, user_id: uuid.UUID) -> builtins.list[SyncState]: ...


class SyncQueue(Protocol):
    def enqueue(self, user_id: uuid.UUID, account_id: uuid.UUID, *, countdown: int = 0) -> None:
        """Schedule a run. Only identifiers cross the queue — never credentials."""


@dataclass(frozen=True, slots=True)
class SyncScope:
    """Collaborators bound to one tenant-scoped transaction."""

    states: SyncStateRepository
    sessions: ProviderSessionFactory
    ingestor: MessageIngestor
    folders: FolderService
    owner_is_active: Callable[[uuid.UUID], Awaitable[bool]]


class SyncUnitOfWork(Protocol):
    def __call__(self, user_id: uuid.UUID) -> AbstractAsyncContextManager[SyncScope]: ...


@dataclass(frozen=True, slots=True)
class SyncPolicy:
    interval: timedelta
    page_size: int
    pages_per_run: int
    backfill_max_messages: int
    lock_ttl_seconds: int
    rate_limit_backoff: timedelta = timedelta(seconds=90)


class SyncRequestService:
    """API side: queue a manual sync and report status."""

    def __init__(
        self,
        states: SyncStateRepository,
        sessions: ProviderSessionFactory,
        queue: SyncQueue,
        limiter: RateLimiter,
        clock: Clock,
    ) -> None:
        self._states = states
        self._sessions = sessions
        self._queue = queue
        self._limiter = limiter
        self._clock = clock

    async def request(
        self, user_id: uuid.UUID, account_id: uuid.UUID, *, throttle: bool = False
    ) -> None:
        account = await self._sessions.get_account(user_id, account_id)  # ownership check
        if throttle:
            await self._limiter.hit(f"sync:{user_id}:{account_id}", limit=6, window_seconds=60)
        state = await self._states.get(user_id, account.id) or SyncState(account_id=account.id)
        if state.status is not SyncStatus.RUNNING:
            state.status = SyncStatus.QUEUED
        state.next_sync_at = self._clock.now() + timedelta(minutes=2)  # scheduler lease
        await self._states.save(user_id, state)
        # Small delay so the worker starts after this request's transaction has committed.
        self._queue.enqueue(user_id, account.id, countdown=2)

    async def request_all(self, user_id: uuid.UUID, account_ids: list[uuid.UUID]) -> int:
        await self._limiter.hit(f"sync-all:{user_id}", limit=6, window_seconds=60)
        for account_id in account_ids:
            await self.request(user_id, account_id)
        return len(account_ids)

    async def status(self, user_id: uuid.UUID) -> dict[uuid.UUID, SyncState]:
        return {s.account_id: s for s in await self._states.list(user_id)}


class SyncRunner:
    """Worker side. One run = folders, incremental changes (or first page), bounded backfill.

    Work is committed in small transactions so progress survives a crash, and every step is
    idempotent, so a run that is repeated or interrupted leaves consistent data.
    """

    def __init__(
        self, uow: SyncUnitOfWork, lock: DistributedLock, clock: Clock, policy: SyncPolicy
    ) -> None:
        self._uow = uow
        self._lock = lock
        self._clock = clock
        self._policy = policy

    async def run(self, user_id: uuid.UUID, account_id: uuid.UUID) -> str:
        key = f"mf:u:{user_id}:acct:{account_id}:sync"
        async with self._lock.acquire(key, ttl_seconds=self._policy.lock_ttl_seconds) as locked:
            if not locked:
                return "locked"  # another worker is already synchronizing this mailbox
            return await self._run_locked(user_id, account_id)

    async def _run_locked(self, user_id: uuid.UUID, account_id: uuid.UUID) -> str:
        try:
            async with self._uow(user_id) as scope:
                # Re-read the account inside the worker: it may have been disconnected,
                # deactivated or deleted since the task was queued.
                account = await scope.sessions.get_account(user_id, account_id)
                if not account.is_active or not await scope.owner_is_active(user_id):
                    return "inactive"
                state = await scope.states.get(user_id, account_id) or SyncState(account_id)
                state.status = SyncStatus.RUNNING
                state.last_started_at = self._clock.now()
                state.next_sync_at = self._clock.now() + timedelta(
                    seconds=self._policy.lock_ttl_seconds
                )
                await scope.states.save(user_id, state)
        except NotFoundError:
            return "gone"

        try:
            await self._sync_folders(user_id, account_id)
            await self._sync_changes(user_id, account_id)
            await self._backfill(user_id, account_id)
        except NotFoundError:
            return "gone"  # account removed mid-run; cascading delete already cleaned up
        except DomainError as exc:
            await self._finish(user_id, account_id, error=exc)
            return "error"
        await self._finish(user_id, account_id, error=None)
        return "ok"

    async def _finish(
        self, user_id: uuid.UUID, account_id: uuid.UUID, *, error: DomainError | None
    ) -> None:
        async with self._uow(user_id) as scope:
            state = await scope.states.get(user_id, account_id)
            if state is None:
                return
            now = self._clock.now()
            if error is None:
                state.status = SyncStatus.IDLE
                state.last_synced_at = now
                state.last_error_code = None
                state.consecutive_failures = 0
                state.next_sync_at = now + self._policy.interval
            else:
                state.status = SyncStatus.ERROR
                state.last_error_code = error.code
                state.consecutive_failures += 1
                backoff = min(
                    self._policy.interval * (2 ** min(state.consecutive_failures, 10)), MAX_BACKOFF
                )
                if isinstance(error, ProviderAuthRequiredError | UnsupportedError):
                    backoff = timedelta(days=3650)  # wait for the user to reconnect
                elif isinstance(error, ProviderRateLimitedError):
                    # Provider quotas refill every minute; waiting much longer only delays
                    # mail, so this does not escalate like real failures do.
                    backoff = self._policy.rate_limit_backoff
                    state.consecutive_failures = 0
                state.next_sync_at = now + backoff
            await scope.states.save(user_id, state)

    async def _sync_folders(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        async with self._uow(user_id) as scope, scope.sessions.open(user_id, account_id) as s:
            await scope.folders.sync_from_provider(
                user_id, account_id, await s.provider.list_folders()
            )

    @staticmethod
    async def _fetch(provider: EmailProvider, ids: tuple[str, ...]) -> list[ProviderMessage]:
        async def one(message_id: str) -> ProviderMessage | None:
            try:
                return await provider.get_message(message_id)
            except ProviderNotFound:
                return None  # deleted between listing and fetching

        fetched = await asyncio.gather(*(one(i) for i in ids))
        return [m for m in fetched if m is not None]

    async def _sync_changes(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        async with self._uow(user_id) as scope, scope.sessions.open(user_id, account_id) as s:
            state = await scope.states.get(user_id, account_id)
            if state is None or state.cursor is None:
                return  # first run: the backfill step establishes the cursor
            try:
                changes = await s.provider.synchronize(state.cursor)
            except ProviderCursorExpired:
                # History is gone: drop the local copy and rebuild it from scratch.
                await scope.ingestor.purge_account(user_id, account_id)
                state.reset_for_full_resync()
                await scope.states.save(user_id, state)
                return
            messages = await self._fetch(s.provider, changes.upserted_message_ids)
            await scope.ingestor.ingest(user_id, account_id, messages)
            await scope.ingestor.remove(user_id, account_id, list(changes.deleted_message_ids))
            state.cursor = changes.cursor
            await scope.states.save(user_id, state)

    async def _backfill(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        for _ in range(self._policy.pages_per_run):
            # One transaction per page: a crash loses at most one page of progress.
            async with self._uow(user_id) as scope, scope.sessions.open(user_id, account_id) as s:
                state = await scope.states.get(user_id, account_id)
                if state is None or state.backfill_complete:
                    return
                first_page = state.cursor is None
                page = await s.provider.list_messages(
                    page_token=None if first_page else state.backfill_page_token,
                    page_size=self._policy.page_size,
                )
                messages = await self._fetch(s.provider, page.message_ids)
                await scope.ingestor.ingest(user_id, account_id, messages)
                if first_page:
                    state.cursor = page.cursor
                state.messages_synced += len(messages)
                state.backfill_page_token = page.next_page_token
                state.initial_sync_complete = True
                state.backfill_complete = (
                    page.next_page_token is None
                    or state.messages_synced >= self._policy.backfill_max_messages
                )
                await scope.states.save(user_id, state)
                if state.backfill_complete:
                    return
