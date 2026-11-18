"""Authentication use cases: registration, sessions, passwords."""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import timedelta

from app.modules.authentication.application.ports import (
    AuthNotifier,
    OneTimeTokenRepository,
    PasswordHasher,
    SessionRepository,
)
from app.modules.authentication.domain.entities import (
    AuthContext,
    OneTimeTokenKind,
    Session,
    validate_password,
)
from app.modules.users.application import UserRepository
from app.modules.users.domain import User, normalize_display_name, normalize_email
from app.shared.application.ports import AuditLog, Clock, RateLimiter
from app.shared.domain.errors import (
    EmailNotVerifiedError,
    InvalidCredentialsError,
    InvalidInputError,
    NotFoundError,
)

SUPPORTED_LOCALES = ("en", "uk")
TOUCH_INTERVAL = timedelta(minutes=5)


@dataclass(frozen=True, slots=True)
class AuthPolicy:
    session_ttl: timedelta
    session_idle_timeout: timedelta
    verification_ttl: timedelta
    reset_ttl: timedelta
    require_email_verification: bool


class TokenFactory:
    """Indirection so tests can control tokens; production uses ``app.core.security.tokens``."""

    def __init__(self, generate, digest) -> None:  # type: ignore[no-untyped-def]
        self.generate = generate
        self.digest = digest


def _locale(value: str | None) -> str:
    return value if value in SUPPORTED_LOCALES else "en"


def _identity_key(email: str) -> str:
    return hashlib.sha256(email.encode()).hexdigest()[:32]


class RegistrationService:
    def __init__(
        self,
        users: UserRepository,
        tokens: OneTimeTokenRepository,
        hasher: PasswordHasher,
        notifier: AuthNotifier,
        token_factory: TokenFactory,
        limiter: RateLimiter,
        audit: AuditLog,
        clock: Clock,
        policy: AuthPolicy,
    ) -> None:
        self._users = users
        self._tokens = tokens
        self._hasher = hasher
        self._notifier = notifier
        self._tf = token_factory
        self._limiter = limiter
        self._audit = audit
        self._clock = clock
        self._policy = policy

    async def register(
        self, *, email: str, password: str, display_name: str, locale: str | None
    ) -> None:
        """Create an account. The outcome is indistinguishable for existing addresses."""
        email = normalize_email(email)
        validate_password(password)
        name = normalize_display_name(display_name)
        if not name:
            raise InvalidInputError("Display name is required.")
        password_hash = self._hasher.hash(password)  # always spend the hashing time
        if await self._users.get_by_email(email) is not None:
            return
        user = await self._users.add(email=email, display_name=name, password_hash=password_hash)
        await self._audit.record("user.registered", user_id=user.id)
        if self._policy.require_email_verification:
            await self._issue_verification(user, _locale(locale))
        else:
            await self._users.mark_verified(user.id, self._clock.now())

    async def _issue_verification(self, user: User, locale: str) -> None:
        token = self._tf.generate()
        await self._tokens.invalidate_all(OneTimeTokenKind.EMAIL_VERIFICATION, user.id)
        await self._tokens.add(
            OneTimeTokenKind.EMAIL_VERIFICATION,
            user_id=user.id,
            token_hash=self._tf.digest(token),
            expires_at=self._clock.now() + self._policy.verification_ttl,
        )
        await self._notifier.send_verification(to=user.email, token=token, locale=locale)

    async def resend_verification(self, *, email: str, locale: str | None) -> None:
        email = normalize_email(email)
        await self._limiter.hit(
            f"verify-resend:{_identity_key(email)}", limit=3, window_seconds=3600
        )
        user = await self._users.get_by_email(email)
        if user is None or user.email_verified or not user.is_active:
            return
        await self._issue_verification(user, _locale(locale))

    async def verify_email(self, token: str) -> None:
        user_id = await self._tokens.consume(
            OneTimeTokenKind.EMAIL_VERIFICATION, self._tf.digest(token), self._clock.now()
        )
        if user_id is None:
            raise InvalidInputError("This link is invalid or has expired.", code="invalid_token")
        await self._users.mark_verified(user_id, self._clock.now())
        await self._audit.record("user.email_verified", user_id=user_id)


class SessionService:
    def __init__(
        self,
        users: UserRepository,
        sessions: SessionRepository,
        hasher: PasswordHasher,
        token_factory: TokenFactory,
        limiter: RateLimiter,
        audit: AuditLog,
        clock: Clock,
        policy: AuthPolicy,
    ) -> None:
        self._users = users
        self._sessions = sessions
        self._hasher = hasher
        self._tf = token_factory
        self._limiter = limiter
        self._audit = audit
        self._clock = clock
        self._policy = policy

    async def login(
        self, *, email: str, password: str, ip_address: str | None, user_agent: str | None
    ) -> tuple[User, str]:
        email = normalize_email(email)
        await self._limiter.hit(f"login:{_identity_key(email)}", limit=10, window_seconds=900)
        user = await self._users.get_by_email(email)
        valid = self._hasher.verify(user.password_hash if user else None, password)
        if user is None or not valid or not user.is_active:
            await self._audit.record(
                "auth.login_failed", user_id=user.id if user else None, ip_address=ip_address
            )
            raise InvalidCredentialsError
        if self._policy.require_email_verification and not user.email_verified:
            raise EmailNotVerifiedError
        if self._hasher.needs_rehash(user.password_hash):
            await self._users.set_password(user.id, self._hasher.hash(password))
        token = await self.open_session(
            user, ip_address=ip_address, user_agent=user_agent, method="password"
        )
        return user, token

    async def open_session(
        self, user: User, *, ip_address: str | None, user_agent: str | None, method: str
    ) -> str:
        """Create a session for an already authenticated user and return its raw token."""
        token: str = self._tf.generate()
        now = self._clock.now()
        await self._sessions.add(
            user_id=user.id,
            token_hash=self._tf.digest(token),
            now=now,
            expires_at=now + self._policy.session_ttl,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        await self._audit.record(
            "auth.login", user_id=user.id, ip_address=ip_address, metadata={"method": method}
        )
        return token

    async def authenticate(self, token: str | None) -> AuthContext | None:
        """Resolve a raw session token to a principal, or None. Never raises for bad tokens."""
        if not token or len(token) > 200:
            return None
        session = await self._sessions.get_by_token_hash(self._tf.digest(token))
        now = self._clock.now()
        if session is None or not session.is_valid(now, self._policy.session_idle_timeout):
            return None
        user = await self._users.get_by_id(session.user_id)
        if user is None or not user.is_active:
            return None
        if now - session.last_seen_at > TOUCH_INTERVAL:
            await self._sessions.touch(session.id, now)
        return AuthContext(user_id=user.id, session_id=session.id)

    async def logout(self, auth: AuthContext) -> None:
        await self._sessions.revoke(auth.user_id, auth.session_id, self._clock.now())

    async def list_sessions(self, user_id: uuid.UUID) -> list[Session]:
        return await self._sessions.list_active(user_id, self._clock.now())

    async def revoke(self, user_id: uuid.UUID, session_id: uuid.UUID) -> None:
        if not await self._sessions.revoke(user_id, session_id, self._clock.now()):
            raise NotFoundError
        await self._audit.record("auth.session_revoked", user_id=user_id)

    async def revoke_others(self, auth: AuthContext) -> None:
        await self._sessions.revoke_all(auth.user_id, self._clock.now(), except_id=auth.session_id)

    async def revoke_all(self, user_id: uuid.UUID) -> None:
        await self._sessions.revoke_all(user_id, self._clock.now())


class PasswordService:
    def __init__(
        self,
        users: UserRepository,
        sessions: SessionRepository,
        tokens: OneTimeTokenRepository,
        hasher: PasswordHasher,
        notifier: AuthNotifier,
        token_factory: TokenFactory,
        limiter: RateLimiter,
        audit: AuditLog,
        clock: Clock,
        policy: AuthPolicy,
    ) -> None:
        self._users = users
        self._sessions = sessions
        self._tokens = tokens
        self._hasher = hasher
        self._notifier = notifier
        self._tf = token_factory
        self._limiter = limiter
        self._audit = audit
        self._clock = clock
        self._policy = policy

    async def request_reset(self, *, email: str, locale: str | None) -> None:
        email = normalize_email(email)
        await self._limiter.hit(f"pw-forgot:{_identity_key(email)}", limit=3, window_seconds=3600)
        user = await self._users.get_by_email(email)
        if user is None or not user.is_active:
            return
        token = self._tf.generate()
        await self._tokens.invalidate_all(OneTimeTokenKind.PASSWORD_RESET, user.id)
        await self._tokens.add(
            OneTimeTokenKind.PASSWORD_RESET,
            user_id=user.id,
            token_hash=self._tf.digest(token),
            expires_at=self._clock.now() + self._policy.reset_ttl,
        )
        await self._notifier.send_password_reset(to=user.email, token=token, locale=_locale(locale))

    async def reset(self, *, token: str, new_password: str) -> None:
        validate_password(new_password, field="new_password")
        now = self._clock.now()
        user_id = await self._tokens.consume(
            OneTimeTokenKind.PASSWORD_RESET, self._tf.digest(token), now
        )
        if user_id is None:
            raise InvalidInputError("This link is invalid or has expired.", code="invalid_token")
        await self._users.set_password(user_id, self._hasher.hash(new_password))
        # Possession of the mailbox was just proven, so the address counts as verified.
        user = await self._users.get_by_id(user_id)
        if user is not None and not user.email_verified:
            await self._users.mark_verified(user_id, now)
        await self._sessions.revoke_all(user_id, now)
        await self._audit.record("auth.password_reset", user_id=user_id)

    async def change(self, auth: AuthContext, *, current_password: str, new_password: str) -> None:
        await self._limiter.hit(f"pw-change:{auth.user_id}", limit=10, window_seconds=900)
        user = await self._users.get_by_id(auth.user_id)
        if user is None or not self._hasher.verify(user.password_hash, current_password):
            raise InvalidCredentialsError("Incorrect password.")
        validate_password(new_password, field="new_password")
        await self._users.set_password(user.id, self._hasher.hash(new_password))
        await self._sessions.revoke_all(user.id, self._clock.now(), except_id=auth.session_id)
        await self._audit.record("auth.password_changed", user_id=user.id)
