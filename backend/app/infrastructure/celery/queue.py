from __future__ import annotations

import uuid

from app.infrastructure.celery.app import celery_app


class CelerySyncQueue:
    def enqueue(self, user_id: uuid.UUID, account_id: uuid.UUID, *, countdown: int = 0) -> None:
        # Identifiers only. Credentials are read from the Token Vault inside the worker.
        celery_app.send_task(
            "sync.account", args=[str(user_id), str(account_id)], countdown=countdown
        )
