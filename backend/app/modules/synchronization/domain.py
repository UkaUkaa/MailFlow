from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class SyncStatus(StrEnum):
    IDLE = "idle"
    QUEUED = "queued"
    RUNNING = "running"
    ERROR = "error"


@dataclass(slots=True)
class SyncState:
    account_id: uuid.UUID
    status: SyncStatus = SyncStatus.IDLE
    cursor: str | None = None
    backfill_page_token: str | None = None
    backfill_complete: bool = False
    initial_sync_complete: bool = False
    messages_synced: int = 0
    consecutive_failures: int = 0
    last_synced_at: datetime | None = None
    last_started_at: datetime | None = None
    last_error_code: str | None = None
    next_sync_at: datetime | None = None

    def reset_for_full_resync(self) -> None:
        self.cursor = None
        self.backfill_page_token = None
        self.backfill_complete = False
        self.messages_synced = 0
