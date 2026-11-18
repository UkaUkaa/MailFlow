"""Sign in to MailFlow with an external identity provider (OpenID Connect, Google first).

This is MailFlow authentication only. It never grants mailbox access: connecting Gmail is a
separate OAuth grant handled by the ``email_accounts`` module.
"""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
from dataclasses import dataclass

from app.modules.authentication.application.ports import (
    IdentityRepository,
    PasswordHasher,
    PendingSignIn,
    SessionRepository,
    SignInProvider,
    SignInStateStore,
)
from app.modules.authentication.application.services import SessionService
from app.modules.authentication.domain.entities import ExternalIdentity, ExternalSignInError
from app.modules.users.application import UserRepository
from app.modules.users.domain import User, normalize_display_name, normalize_email
from app.shared.application.ports import AuditLog, Clock
from app.shared.domain.errors import ProviderNotConfiguredError

STATE_TTL_SECONDS = 600
DEFAULT_NEXT = "/mail/inbox"
LOCALES = ("en", "uk")
# A same-origin path inside the localized app: no scheme, no host, no "//", no backslash.
_SAFE_NEXT = re.compile(r"^/(?!/)[A-Za-z0-9/_\-.~%?=&]{0,500}$")


def safe_next_path(value: str | None) -> str:
    return value if value and _SAFE_NEXT.match(value) else DEFAULT_NEXT


def _locale(value: str | None) -> str:
    return value if value in LOCALES else "en"


def state_hash(state: str) -> str:
    return hashlib.sha256(state.encode()).hexdigest()


def code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


@dataclass(frozen=True, slots=True)
class StartedSignIn:
    state: str
    authorization_url: str


@dataclass(frozen=True, slots=True)
class SignInOutcome:
    locale: str
    next_path: str
    user: User | None = None
    session_token: str | None = None
    error: str | None = None


class ExternalSignInService:
    def __init__(
        self,
        provider: SignInProvider,
        states: SignInStateStore,
        identities: IdentityRepository,
        users: UserRepository,
        sessions: SessionService,
        session_store: SessionRepository,
        hasher: PasswordHasher,
        audit: AuditLog,
        clock: Clock,
    ) -> None:
        self._provider = provider
        self._states = states
        self._identities = identities
        self._users = users
        self._sessions = sessions
        self._session_store = session_store
        self._hasher = hasher
        self._audit = audit
        self._clock = clock

    @property
    def configured(self) -> bool:
        return self._provider.configured

    async def start(self, *, locale: str | None, next_path: str | None) -> StartedSignIn:
        """Create a single-use state (bound to the browser by the caller), PKCE and nonce."""
        if not self._provider.configured:
            raise ProviderNotConfiguredError
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        nonce = secrets.token_urlsafe(32)
        await self._states.put(
            state_hash(state),
            PendingSignIn(
                code_verifier=verifier,
                nonce=nonce,
                locale=_locale(locale),
                next_path=safe_next_path(next_path),
            ),
            STATE_TTL_SECONDS,
        )
        url = self._provider.authorization_url(
            state=state, code_challenge=code_challenge(verifier), nonce=nonce
        )
        return StartedSignIn(state=state, authorization_url=url)

    async def complete(
        self,
        *,
        code: str | None,
        state: str | None,
        browser_state: str | None,
        provider_error: str | None,
        ip_address: str | None,
        user_agent: str | None,
    ) -> SignInOutcome:
        """Finish the flow. Failures are returned as an error code, never raised, so the
        browser always lands back on the sign-in page with a readable message."""
        # The state must come back in the URL *and* match the cookie set when this browser
        # started the flow. That stops login CSRF: a victim cannot be signed in to an
        # attacker's account through a crafted callback link.
        if not state or not browser_state or not secrets.compare_digest(state, browser_state):
            return SignInOutcome(locale="en", next_path=DEFAULT_NEXT, error="invalid_state")
        pending = await self._states.take(state_hash(state))
        if pending is None:
            return SignInOutcome(locale="en", next_path=DEFAULT_NEXT, error="invalid_state")

        def failed(error: str) -> SignInOutcome:
            return SignInOutcome(locale=pending.locale, next_path=pending.next_path, error=error)

        if provider_error:
            denied = provider_error == "access_denied"
            return failed("access_denied" if denied else "provider_error")
        if not code:
            return failed("provider_error")
        try:
            identity = await self._provider.exchange(
                code=code, code_verifier=pending.code_verifier, nonce=pending.nonce
            )
        except ExternalSignInError:
            return failed("provider_error")
        if not identity.email_verified:
            return failed("email_not_verified")

        user = await self._resolve_user(identity)
        if user is None or not user.is_active:
            await self._audit.record(
                "auth.login_failed",
                user_id=user.id if user else None,
                ip_address=ip_address,
                metadata={"method": identity.provider.value},
            )
            return failed("account_disabled")
        token = await self._sessions.open_session(
            user, ip_address=ip_address, user_agent=user_agent, method=identity.provider.value
        )
        return SignInOutcome(
            locale=pending.locale, next_path=pending.next_path, user=user, session_token=token
        )

    async def _resolve_user(self, identity: ExternalIdentity) -> User | None:
        user_id = await self._identities.get_user_id(identity.provider, identity.subject)
        if user_id is not None:
            return await self._users.get_by_id(user_id)

        email = normalize_email(identity.email)
        now = self._clock.now()
        user = await self._users.get_by_email(email)
        if user is None:
            name = normalize_display_name(identity.display_name) or email.split("@")[0][:100]
            # No usable password: the user signs in with the provider, or sets a password
            # later through "forgot password", which proves mailbox ownership again.
            user = await self._users.add(
                email=email, display_name=name, password_hash=self._unusable_password()
            )
            await self._users.mark_verified(user.id, now)
            await self._audit.record(
                "user.registered", user_id=user.id, metadata={"method": identity.provider.value}
            )
        elif not user.is_active:
            return user
        elif not user.email_verified:
            # Someone registered this address with a password but never proved they own it.
            # The provider just proved ownership, so that unproven password must not keep
            # working (pre-registration account takeover): replace it and end its sessions.
            await self._users.set_password(user.id, self._unusable_password())
            await self._session_store.revoke_all(user.id, now)
            await self._users.mark_verified(user.id, now)
        await self._identities.add(
            user_id=user.id, provider=identity.provider, subject=identity.subject, email=email
        )
        await self._audit.record(
            "auth.identity_linked", user_id=user.id, metadata={"provider": identity.provider.value}
        )
        return await self._users.get_by_id(user.id)

    def _unusable_password(self) -> str:
        return self._hasher.hash(secrets.token_urlsafe(48))
