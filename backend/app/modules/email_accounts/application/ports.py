from __future__ import annotations

import uuid
from datetime import datetime
from typing import Protocol

from app.integrations.email_providers.contracts import ProviderKind
from app.modules.email_accounts.domain import AccountStatus, EmailAccount, OAuthState


class AccountRepository(Protocol):
    async def list(self, user_id: uuid.UUID) -> list[EmailAccount]: ...
    async def get(self, user_id: uuid.UUID, account_id: uuid.UUID) -> EmailAccount | None: ...
    async def get_by_address(
        self, user_id: uuid.UUID, provider: ProviderKind, email_address: str
    ) -> EmailAccount | None: ...
    async def add(
        self,
        *,
        user_id: uuid.UUID,
        provider: ProviderKind,
        email_address: str,
        display_name: str,
        color: str,
    ) -> EmailAccount: ...
    async def update(
        self,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        *,
        display_name: str | None = None,
        color: str | None = None,
    ) -> None: ...
    async def set_status(
        self, user_id: uuid.UUID, account_id: uuid.UUID, status: AccountStatus, reason: str | None
    ) -> None: ...
    async def delete(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None: ...


class OAuthStateRepository(Protocol):
    async def add(
        self,
        *,
        user_id: uuid.UUID,
        provider: ProviderKind,
        state_hash: str,
        sealed_verifier: tuple[str, bytes, bytes],
        reconnect_account_id: uuid.UUID | None,
        locale: str,
        expires_at: datetime,
    ) -> None: ...
    async def consume(
        self, user_id: uuid.UUID, state_hash: str, now: datetime
    ) -> OAuthState | None:
        """Atomically mark the state used. One state can complete at most one flow."""

    async def delete_expired(self, user_id: uuid.UUID, now: datetime) -> None: ...


class AccountStatusMarker(Protocol):
    async def mark(
        self, user_id: uuid.UUID, account_id: uuid.UUID, status: AccountStatus, reason: str | None
    ) -> None:
        """Persist a status change independently of the caller's transaction."""


class SyncRequester(Protocol):
    async def request(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None: ...
