"""Scheduled outbox: messages accepted now and sent later (send later, undo send)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum

from app.integrations.email_providers.contracts import Address, SendMode

MAX_ACTIVE_ITEMS = 100
MAX_SCHEDULE_AHEAD = timedelta(days=366)
MAX_ATTEMPTS = 3
RETRY_BACKOFF = timedelta(seconds=60)
# An item due this soon is handed to a worker directly; later ones wait for the beat scan.
DIRECT_ENQUEUE_WINDOW = timedelta(seconds=60)
# An undo-window item still unsent after this long is shown in the Scheduled list.
OVERDUE_AFTER = timedelta(seconds=60)


class OutboxStatus(StrEnum):
    PENDING = "pending"
    SENDING = "sending"
    SENT = "sent"
    CANCELLED = "cancelled"
    FAILED = "failed"


class OutboxKind(StrEnum):
    SCHEDULED = "scheduled"  # the user picked a time
    UNDO = "undo"  # a normal send held back for the undo window


@dataclass(frozen=True, slots=True)
class OutboxContent:
    to: tuple[Address, ...]
    cc: tuple[Address, ...]
    bcc: tuple[Address, ...]
    subject: str
    body_html: str = field(repr=False)
    mode: SendMode = SendMode.NEW
    source_message_id: uuid.UUID | None = None
    draft_id: uuid.UUID | None = None
    forward_attachment_ids: tuple[uuid.UUID, ...] = ()


@dataclass(frozen=True, slots=True)
class OutboxFileMeta:
    filename: str
    mime_type: str
    size: int


@dataclass(frozen=True, slots=True)
class OutboxFile:
    filename: str
    mime_type: str
    content: bytes = field(repr=False)


@dataclass(slots=True)
class OutboxItem:
    id: uuid.UUID
    user_id: uuid.UUID
    account_id: uuid.UUID
    kind: OutboxKind
    status: OutboxStatus
    send_at: datetime
    idempotency_key: str
    content: OutboxContent
    snippet: str
    created_at: datetime
    attachments: tuple[OutboxFileMeta, ...] = ()
    attempts: int = 0
    error_code: str | None = None
    message_id: uuid.UUID | None = None
    thread_id: uuid.UUID | None = None

    @property
    def can_cancel(self) -> bool:
        return self.status in (OutboxStatus.PENDING, OutboxStatus.FAILED)

    @property
    def can_reschedule(self) -> bool:
        return self.status in (OutboxStatus.PENDING, OutboxStatus.FAILED)

    @property
    def attachment_count(self) -> int:
        return len(self.attachments) + len(self.content.forward_attachment_ids)


def retry_delay(attempts: int) -> timedelta:
    """Backoff before the next attempt after ``attempts`` tries: 1 min, 2 min, 4 min..."""
    factor: int = 2 ** max(0, attempts - 1)
    return RETRY_BACKOFF * factor
