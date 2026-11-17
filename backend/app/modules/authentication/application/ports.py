"""Ports required by the authentication use cases."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Protocol

from app.modules.authentication.domain.entities import OneTimeTokenKind, Session


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
