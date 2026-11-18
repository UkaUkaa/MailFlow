"""Ports required by the authentication use cases."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from app.modules.authentication.domain.entities import (
    ExternalIdentity,
    OneTimeTokenKind,
    Session,
    SignInProviderKind,
)


class PasswordHasher(Protocol):
    def hash(self, password: str) -> str: ...
    def verify(self, password_hash: str | None, password: str) -> bool: ...
    def needs_rehash(self, password_hash: str) -> bool: ...


class SessionRepository(Protocol):
    async def add(
        self,
        *,
        user_id: uuid.UUID,
        token_hash: str,
        now: datetime,
        expires_at: datetime,
        user_agent: str | None,
        ip_address: str | None,
    ) -> Session: ...
    async def get_by_token_hash(self, token_hash: str) -> Session | None: ...
    async def touch(self, session_id: uuid.UUID, now: datetime) -> None: ...
    async def list_active(self, user_id: uuid.UUID, now: datetime) -> list[Session]: ...
    async def revoke(self, user_id: uuid.UUID, session_id: uuid.UUID, now: datetime) -> bool: ...
    async def revoke_all(
        self, user_id: uuid.UUID, now: datetime, *, except_id: uuid.UUID | None = None
    ) -> None: ...
    async def delete_expired(self, before: datetime) -> int: ...


class OneTimeTokenRepository(Protocol):
    async def add(
        self, kind: OneTimeTokenKind, *, user_id: uuid.UUID, token_hash: str, expires_at: datetime
    ) -> None: ...
    async def consume(
        self, kind: OneTimeTokenKind, token_hash: str, now: datetime
    ) -> uuid.UUID | None:
        """Atomically mark the token used; return its user or None if invalid/expired/used."""

    async def invalidate_all(self, kind: OneTimeTokenKind, user_id: uuid.UUID) -> None: ...
    async def delete_expired(self, before: datetime) -> int: ...


class AuthNotifier(Protocol):
    async def send_verification(self, *, to: str, token: str, locale: str) -> None: ...
    async def send_password_reset(self, *, to: str, token: str, locale: str) -> None: ...


@dataclass(frozen=True, slots=True)
class PendingSignIn:
    """Server-side half of an external sign-in, stored under the hash of its state."""

    code_verifier: str
    nonce: str
    locale: str
    next_path: str


class SignInStateStore(Protocol):
    async def put(self, state_hash: str, pending: PendingSignIn, ttl_seconds: int) -> None: ...
    async def take(self, state_hash: str) -> PendingSignIn | None:
        """Atomically remove and return the pending sign-in. One state completes one flow."""


class SignInProvider(Protocol):
    kind: SignInProviderKind

    @property
    def configured(self) -> bool: ...
    def authorization_url(self, *, state: str, code_challenge: str, nonce: str) -> str: ...
    async def exchange(self, *, code: str, code_verifier: str, nonce: str) -> ExternalIdentity:
        """Redeem the code and return the validated identity; raise ExternalSignInError."""


class IdentityRepository(Protocol):
    async def get_user_id(self, provider: SignInProviderKind, subject: str) -> uuid.UUID | None: ...
    async def add(
        self, *, user_id: uuid.UUID, provider: SignInProviderKind, subject: str, email: str
    ) -> None: ...
