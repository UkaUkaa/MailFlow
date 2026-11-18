"""Celery task definitions. Each task builds its own runtime inside a fresh event loop."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta

from sqlalchemy import text

from app.bootstrap import Runtime, Services
from app.core.config import get_settings
from app.core.database.engine import system_transaction, tenant_transaction
from app.core.logging import configure_logging, get_logger
from app.infrastructure.celery.app import celery_app
from app.infrastructure.celery.queue import CeleryOutboxQueue, CelerySyncQueue
from app.infrastructure.redis import RedisLock
from app.modules.outbox.application import OutboxDispatcher, OutboxQueue, OutboxScope
from app.modules.synchronization.application import SyncPolicy, SyncRunner, SyncScope

logger = get_logger(__name__)
CLAIM_BATCH = 200
OUTBOX_ENQUEUE_LEASE = 120  # seconds an enqueued outbox id is left to its worker


def _policy() -> SyncPolicy:
    settings = get_settings()
    return SyncPolicy(
        interval=timedelta(seconds=settings.sync_interval_seconds),
        page_size=settings.sync_initial_page_size,
        pages_per_run=settings.sync_pages_per_run,
        backfill_max_messages=settings.sync_backfill_max_messages,
        lock_ttl_seconds=settings.sync_lock_ttl_seconds,
        rate_limit_backoff=timedelta(seconds=settings.sync_rate_limit_backoff_seconds),
    )


def build_runner(runtime: Runtime, policy: SyncPolicy) -> SyncRunner:
    @asynccontextmanager
    async def unit_of_work(user_id: uuid.UUID) -> AsyncIterator[SyncScope]:
        async with tenant_transaction(runtime.session_factory, user_id) as session:
            services = Services(session, runtime)

            async def owner_is_active(owner_id: uuid.UUID) -> bool:
                owner = await services.users.get_by_id(owner_id)
                return owner is not None and owner.is_active

            yield SyncScope(
                states=services.sync_states,
                sessions=services.provider_sessions,
                ingestor=services.ingestor,
                folders=services.folders,
                owner_is_active=owner_is_active,
            )

    return SyncRunner(unit_of_work, RedisLock(runtime.redis), runtime.clock, policy)


async def _sync_account(user_id: uuid.UUID, account_id: uuid.UUID) -> str:
    runtime = Runtime.create(get_settings(), pooled=False)
    try:
        return await build_runner(runtime, _policy()).run(user_id, account_id)
    finally:
        await runtime.close()


async def _schedule_due() -> int:
    settings = get_settings()
    runtime = Runtime.create(settings, pooled=False)
    queue = CelerySyncQueue()
    try:
        async with system_transaction(runtime.session_factory) as session:
            rows = await session.execute(
                text("SELECT user_id, account_id FROM mailflow_claim_due_syncs(:n, :lease)"),
                {"n": CLAIM_BATCH, "lease": settings.sync_lock_ttl_seconds},
            )
            claimed = rows.all()
        for user_id, account_id in claimed:
            queue.enqueue(user_id, account_id)
        return len(claimed)
    finally:
        await runtime.close()


def build_dispatcher(runtime: Runtime) -> OutboxDispatcher:
    @asynccontextmanager
    async def unit_of_work(user_id: uuid.UUID) -> AsyncIterator[OutboxScope]:
        async with tenant_transaction(runtime.session_factory, user_id) as session:
            services = Services(session, runtime)

            async def owner_is_active(owner_id: uuid.UUID) -> bool:
                owner = await services.users.get_by_id(owner_id)
                return owner is not None and owner.is_active

            yield OutboxScope(
                outbox=services.outbox_repository,
                compose=services.compose,
                owner_is_active=owner_is_active,
            )

    lease = timedelta(seconds=runtime.settings.sync_lock_ttl_seconds + 120)
    return OutboxDispatcher(unit_of_work, runtime.clock, lease)


async def dispatch_due_outbox(runtime: Runtime, queue: OutboxQueue) -> int:
    """Find due outbox items (``FOR UPDATE SKIP LOCKED`` inside the definer function) and hand
    their ids to workers. The lease keeps the next scan from enqueueing them again."""
    async with system_transaction(runtime.session_factory) as session:
        rows = await session.execute(
            text("SELECT user_id, outbox_id FROM mailflow_claim_due_outbox(:n, :lease)"),
            {"n": CLAIM_BATCH, "lease": OUTBOX_ENQUEUE_LEASE},
        )
        claimed = rows.all()
    for user_id, outbox_id in claimed:
        queue.enqueue(user_id, outbox_id)
    return len(claimed)


async def _send_outbox(user_id: uuid.UUID, outbox_id: uuid.UUID) -> str:
    runtime = Runtime.create(get_settings(), pooled=False)
    try:
        return await build_dispatcher(runtime).run(user_id, outbox_id)
    finally:
        await runtime.close()


async def _dispatch_due_outbox() -> int:
    runtime = Runtime.create(get_settings(), pooled=False)
    try:
        return await dispatch_due_outbox(runtime, CeleryOutboxQueue())
    finally:
        await runtime.close()


async def _cleanup() -> None:
    runtime = Runtime.create(get_settings(), pooled=False)
    try:
        async with system_transaction(runtime.session_factory) as session:
            await session.execute(text("SELECT mailflow_cleanup_expired()"))
    finally:
        await runtime.close()


@celery_app.task(name="sync.account")  # type: ignore[untyped-decorator]
def sync_account(user_id: str, account_id: str) -> str:
    configure_logging(get_settings().log_level)
    outcome = asyncio.run(_sync_account(uuid.UUID(user_id), uuid.UUID(account_id)))
    logger.info("sync_finished", account_id=account_id, outcome=outcome)
    return outcome


@celery_app.task(name="sync.schedule_due")  # type: ignore[untyped-decorator]
def schedule_due() -> int:
    return asyncio.run(_schedule_due())


@celery_app.task(name="maintenance.cleanup")  # type: ignore[untyped-decorator]
def cleanup() -> None:
    asyncio.run(_cleanup())


@celery_app.task(name="outbox.send")  # type: ignore[untyped-decorator]
def send_outbox(user_id: str, outbox_id: str) -> str:
    configure_logging(get_settings().log_level)
    outcome = asyncio.run(_send_outbox(uuid.UUID(user_id), uuid.UUID(outbox_id)))
    logger.info("outbox_send_finished", outbox_id=outbox_id, outcome=outcome)
    return outcome


@celery_app.task(name="outbox.dispatch_due")  # type: ignore[untyped-decorator]
def dispatch_due() -> int:
    return asyncio.run(_dispatch_due_outbox())
