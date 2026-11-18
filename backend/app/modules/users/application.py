"""User profile and account lifecycle use cases."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Protocol

from app.modules.users.domain import User, UserStatus, normalize_display_name
from app.shared.application.ports import AuditLog, TenantCache
from app.shared.domain.errors import InvalidCredentialsError, InvalidInputError, NotFoundError


class UserRepository(Protocol):
    async def get_by_id(self, user_id: uuid.UUID) -> User | None: ...
    async def get_by_email(self, email: str) -> User | None: ...
    async def add(self, *, email: str, display_name: str, password_hash: str) -> User: ...
    async def set_password(self, user_id: uuid.UUID, password_hash: str) -> None: ...
    async def mark_verified(self, user_id: uuid.UUID, at: datetime) -> None: ...
    async def set_display_name(self, user_id: uuid.UUID, display_name: str) -> None: ...
    async def set_status(self, user_id: uuid.UUID, status: UserStatus) -> None: ...
    async def delete(self, user_id: uuid.UUID) -> None: ...


class PasswordVerifier(Protocol):
    def verify(self, password_hash: str | None, password: str) -> bool: ...


class ReauthVerifier(Protocol):
    async def consume(self, user_id: uuid.UUID, purpose: str, token: str) -> bool:
        """Redeem a single-use re-confirmation (e.g. a fresh Google sign-in) for ``purpose``."""


class SessionRevoker(Protocol):
    async def revoke_all(self, user_id: uuid.UUID) -> None: ...


class MailboxDisconnector(Protocol):
    async def disconnect_all(self, user_id: uuid.UUID) -> None:
        """Revoke provider grants where possible and delete every mailbox of the user."""


class UserProfileService:
    def __init__(self, users: UserRepository) -> None:
        self._users = users

    async def get(self, user_id: uuid.UUID) -> User:
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise NotFoundError
        return user

    async def rename(self, user_id: uuid.UUID, display_name: str) -> User:
        name = normalize_display_name(display_name)
        if not name:
            raise InvalidInputError("Display name is required.")
        await self._users.set_display_name(user_id, name)
        return await self.get(user_id)


class AccountLifecycleService:
    """Deactivation and deletion. Both are idempotent and safe to retry."""

    def __init__(
        self,
        users: UserRepository,
        passwords: PasswordVerifier,
        sessions: SessionRevoker,
        mailboxes: MailboxDisconnector,
        cache: TenantCache,
        audit: AuditLog,
        reauth: ReauthVerifier,
    ) -> None:
        self._users = users
        self._passwords = passwords
        self._reauth = reauth
        self._sessions = sessions
        self._mailboxes = mailboxes
        self._cache = cache
        self._audit = audit

    async def _confirm(
        self, user_id: uuid.UUID, purpose: str, password: str | None, reauth_token: str | None
    ) -> User:
        """Either the password or a fresh re-confirmation grant for this very action.

        Users who signed up with Google never chose a password, so they confirm by signing in
        to Google again instead.
        """
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise NotFoundError
        if password is not None:
            if not self._passwords.verify(user.password_hash, password):
                raise InvalidCredentialsError("Incorrect password.")
        elif reauth_token is None or not await self._reauth.consume(user_id, purpose, reauth_token):
            raise InvalidCredentialsError("Confirmation is missing or expired.")
        return user

    async def deactivate(
        self, user_id: uuid.UUID, *, password: str | None = None, reauth_token: str | None = None
    ) -> None:
        await self._confirm(user_id, "deactivate", password, reauth_token)
        # Status first: the scheduler and running tasks skip non-active users from here on.
        await self._users.set_status(user_id, UserStatus.DEACTIVATED)
        await self._sessions.revoke_all(user_id)
        await self._audit.record("user.deactivated", user_id=user_id)

    async def delete(
        self, user_id: uuid.UUID, *, password: str | None = None, reauth_token: str | None = None
    ) -> None:
        await self._confirm(user_id, "delete", password, reauth_token)
        await self._users.set_status(user_id, UserStatus.DELETING)
        await self._sessions.revoke_all(user_id)
        await self._mailboxes.disconnect_all(user_id)
        await self._cache.purge_user(user_id)
        await self._users.delete(user_id)  # cascades to every remaining tenant row
        await self._audit.forget_user(user_id)
        await self._audit.record("user.deleted")  # deliberately not linked to the user
