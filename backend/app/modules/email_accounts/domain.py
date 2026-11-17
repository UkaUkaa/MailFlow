"""Connected mailbox aggregate."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from app.integrations.email_providers.contracts import ProviderKind

ACCOUNT_COLORS = ("blue", "green", "amber", "red", "violet", "teal", "pink", "slate")
MAX_ACCOUNTS_PER_USER = 10


class AccountStatus(StrEnum):
    ACTIVE = "active"
    NEEDS_REAUTH = "needs_reauth"
    ERROR = "error"
    DISABLED = "disabled"


@dataclass(slots=True)
class EmailAccount:
    id: uuid.UUID
    user_id: uuid.UUID
    provider: ProviderKind
    email_address: str
    display_name: str
    color: str
    status: AccountStatus
    status_reason: str | None
    created_at: datetime

    @property
    def is_active(self) -> bool:
        return self.status is AccountStatus.ACTIVE


@dataclass(frozen=True, slots=True)
class OAuthState:
    id: uuid.UUID
    user_id: uuid.UUID
    provider: ProviderKind
    sealed_verifier: tuple[str, bytes, bytes]  # key id, nonce, ciphertext
    reconnect_account_id: uuid.UUID | None
    locale: str
