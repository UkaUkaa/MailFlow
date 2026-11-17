"""Celery application. Tasks carry identifiers only; see ``tasks.py``."""

from __future__ import annotations

from celery import Celery
from kombu import Queue

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "mailflow", broker=settings.broker_url, include=["app.infrastructure.celery.tasks"]
)
celery_app.conf.update(
    task_ignore_result=True,
    task_acks_late=True,  # a task is redelivered if its worker dies mid-run
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,  # fair distribution; one slow mailbox cannot hoard tasks
    worker_max_tasks_per_child=200,
    task_soft_time_limit=settings.sync_lock_ttl_seconds - 60,
    task_time_limit=settings.sync_lock_ttl_seconds,
    task_default_queue="default",
    task_queues=(Queue("default"), Queue("sync"), Queue("maintenance")),
    task_routes={
        "sync.account": {"queue": "sync"},
        "sync.schedule_due": {"queue": "maintenance"},
        "maintenance.cleanup": {"queue": "maintenance"},
    },
    broker_transport_options={"visibility_timeout": settings.sync_lock_ttl_seconds + 120},
    broker_connection_retry_on_startup=True,
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "schedule-due-syncs": {"task": "sync.schedule_due", "schedule": 30.0},
        "cleanup-expired": {"task": "maintenance.cleanup", "schedule": 3600.0},
    },
)
