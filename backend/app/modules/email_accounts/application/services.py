"""Connecting, listing, updating and disconnecting mailboxes."""

from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta

from app.integrations.email_providers.contracts import (
    ProviderAuthError,
    ProviderDestinationBlocked,
    ProviderError,
    ProviderKind,
    ProviderRegistry,
    ProviderTlsRequired,
    ServerCredentials,
)
from app.modules.email_accounts.application.ports import (
    AccountRepository,
    OAuthStateRepository,
    SyncRequester,
)
from app.modules.email_accounts.application.sessions import (
    credentials_to_secret,
    secret_to_credentials,
    secret_to_server_credentials,
    server_credentials_to_secret,
)
from app.modules.email_accounts.domain import (
    ACCOUNT_COLORS,
    MAX_ACCOUNTS_PER_USER,
    MAX_AVATAR_BYTES,
    AccountStatus,
    EmailAccount,
    avatar_media_type,
    normalize_color,
)
from app.modules.token_vault.application import Cipher, TokenVault
from app.modules.token_vault.domain import CredentialKind, SealedSecret, VaultError
from app.shared.application.ports import AuditLog, Clock, RateLimiter
from app.shared.domain.errors import (
    ConflictError,
    FieldProblem,
    InvalidInputError,
    NotFoundError,
    PayloadTooLargeError,
    ProviderNotConfiguredError,
    UnsupportedError,
)

LOCALES = ("en", "uk")
# Connecting probes servers chosen by the user, so attempts are scarce on purpose.
PASSWORD_CONNECT_LIMIT = 10
PASSWORD_CONNECT_WINDOW_SECONDS = 3600


class MailServerCheckError(InvalidInputError):
    """The mail servers did not accept the submitted settings.

    Only four outcomes are distinguished — ``blocked_destination``, ``authentication_failed``,
    ``tls_required`` and ``connection_failed`` — so the endpoint says nothing more about a
    host than "a mail login did not work" (closed port, timeout, wrong protocol and a bad
    certificate all look the same).
    """

    def __init__(self, code: str, service: str | None) -> None:
        messages = {
            "blocked_destination": "This server address is not allowed.",
            "authentication_failed": "The mail server rejected the user name or password.",
            "tls_required": "The mail server does not offer an encrypted connection.",
            "connection_failed": "Could not connect to the mail server.",
        }
        problems = [FieldProblem(service, code)] if service in ("imap", "smtp") else None
        super().__init__(messages[code], problems=problems, code=code)


def _check_error(exc: ProviderError) -> MailServerCheckError:
    if isinstance(exc, ProviderDestinationBlocked):
        code = "blocked_destination"
    elif isinstance(exc, ProviderAuthError):
        code = "authentication_failed"
    elif isinstance(exc, ProviderTlsRequired):
        code = "tls_required"
    else:
        code = "connection_failed"
    return MailServerCheckError(code, exc.service)


@dataclass(frozen=True, slots=True)
class OAuthOutcome:
    locale: str
    account_id: uuid.UUID | None = None
    error: str | None = None


def _state_hash(state: str) -> str:
    return hashlib.sha256(state.encode()).hexdigest()


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _state_aad(user_id: uuid.UUID) -> bytes:
    return f"mailflow:v1|oauth-state|{user_id}".encode()


class ConnectAccountService:
    def __init__(
        self,
        accounts: AccountRepository,
        states: OAuthStateRepository,
        vault: TokenVault,
        cipher: Cipher,
        registry: ProviderRegistry,
        sync: SyncRequester,
        limiter: RateLimiter,
        audit: AuditLog,
        clock: Clock,
        state_ttl: timedelta,
    ) -> None:
        self._accounts = accounts
        self._states = states
        self._vault = vault
        self._cipher = cipher
        self._registry = registry
        self._sync = sync
        self._limiter = limiter
        self._audit = audit
        self._clock = clock
        self._state_ttl = state_ttl

    async def start(
        self,
        user_id: uuid.UUID,
        provider: ProviderKind,
        *,
        locale: str | None,
        reconnect_account_id: uuid.UUID | None = None,
    ) -> str:
        """Create a single-use state + PKCE verifier and return the provider consent URL."""
        await self._limiter.hit(f"oauth-start:{user_id}", limit=20, window_seconds=3600)
        if not self._registry.capabilities(provider).oauth:
            raise UnsupportedError("This mailbox is not connected through OAuth.")
        if not self._registry.is_available(provider):
            raise ProviderNotConfiguredError
        login_hint = None
        if reconnect_account_id is not None:
            account = await self._accounts.get(user_id, reconnect_account_id)
            if account is None or account.provider is not provider:
                raise NotFoundError
            login_hint = account.email_address
        elif len(await self._accounts.list(user_id)) >= MAX_ACCOUNTS_PER_USER:
            raise ConflictError("Account limit reached.", code="account_limit_reached")

        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        sealed = self._cipher.seal(verifier.encode("ascii"), aad=_state_aad(user_id))
        now = self._clock.now()
        await self._states.delete_expired(user_id, now)
        await self._states.add(
            user_id=user_id,
            provider=provider,
            state_hash=_state_hash(state),
            sealed_verifier=(sealed.key_id, sealed.nonce, sealed.ciphertext),
            reconnect_account_id=reconnect_account_id,
            locale=locale if locale in LOCALES else "en",
            expires_at=now + self._state_ttl,
        )
        return self._registry.oauth_client(provider).authorization_url(
            state=state, code_challenge=_challenge(verifier), login_hint=login_hint
        )

    async def complete(
        self,
        user_id: uuid.UUID,
        provider: ProviderKind,
        *,
        code: str | None,
        state: str | None,
        provider_error: str | None,
    ) -> OAuthOutcome:
        """Finish the flow. Expected failures are returned (for a redirect), not raised."""
        if not state or len(state) > 200:
            return OAuthOutcome("en", error="invalid_state")
        # The state row is bound to the session user: a state issued to another user (login
        # CSRF / account mix-up) is simply not found.
        record = await self._states.consume(user_id, _state_hash(state), self._clock.now())
        if record is None or record.provider is not provider:
            return OAuthOutcome("en", error="invalid_state")
        locale = record.locale
        if provider_error or not code:
            return OAuthOutcome(locale, error="access_denied" if provider_error else "missing_code")
        oauth = self._registry.oauth_client(provider)
        try:
            key_id, nonce, ciphertext = record.sealed_verifier
            verifier = self._cipher.open(
                SealedSecret(key_id, nonce, ciphertext), aad=_state_aad(user_id)
            ).decode("ascii")
            credentials = await oauth.authenticate(code=code, code_verifier=verifier)
            identity = await oauth.fetch_identity(credentials)
        except ProviderAuthError:
            return OAuthOutcome(locale, error="authorization_failed")
        except (ProviderError, VaultError):
            return OAuthOutcome(locale, error="provider_unavailable")

        account: EmailAccount | None
        if record.reconnect_account_id is not None:
            account = await self._accounts.get(user_id, record.reconnect_account_id)
            if account is None or account.email_address != identity.email:
                await self._revoke_quietly(provider, credentials_to_secret(credentials))
                return OAuthOutcome(locale, error="account_mismatch")
        else:
            account = await self._accounts.get_by_address(user_id, provider, identity.email)
        if account is None:
            existing = await self._accounts.list(user_id)
            if len(existing) >= MAX_ACCOUNTS_PER_USER:
                await self._revoke_quietly(provider, credentials_to_secret(credentials))
                return OAuthOutcome(locale, error="account_limit_reached")
            account = await self._accounts.add(
                user_id=user_id,
                provider=provider,
                email_address=identity.email,
                display_name=identity.email,
                color=ACCOUNT_COLORS[len(existing) % len(ACCOUNT_COLORS)],
            )
            event = "account.connected"
        else:
            event = "account.reconnected"
        await self._vault.store(
            user_id=user_id,
            account_id=account.id,
            kind=CredentialKind.OAUTH_TOKENS,
            secret=credentials_to_secret(credentials),
            expires_at=credentials.expires_at,
        )
        await self._accounts.set_status(user_id, account.id, AccountStatus.ACTIVE, None)
        await self._sync.request(user_id, account.id)
        await self._audit.record(event, user_id=user_id, metadata={"provider": provider.value})
        return OAuthOutcome(locale, account_id=account.id)

    # -- password-based mailboxes (IMAP/SMTP) ------------------------------------------------

    async def _verify(self, user_id: uuid.UUID, credentials: ServerCredentials) -> None:
        await self._limiter.hit(
            f"imap-connect:{user_id}",
            limit=PASSWORD_CONNECT_LIMIT,
            window_seconds=PASSWORD_CONNECT_WINDOW_SECONDS,
        )
        if not self._registry.is_available(ProviderKind.IMAP):
            raise ProviderNotConfiguredError
        try:
            await self._registry.verify_credentials(ProviderKind.IMAP, credentials)
        except ProviderError as exc:
            raise _check_error(exc) from None  # the cause may quote the server; drop it

    async def connect_with_password(
        self,
        user_id: uuid.UUID,
        *,
        email_address: str,
        display_name: str | None,
        credentials: ServerCredentials,
    ) -> tuple[EmailAccount, bool]:
        """Check both logins, then create the mailbox (or replace the credentials of the same
        address). Returns the account and whether it is new. The password goes to the Token
        Vault only: never to the audit log, the queue or the response."""
        email_address = email_address.strip().lower()
        account = await self._accounts.get_by_address(user_id, ProviderKind.IMAP, email_address)
        existing = await self._accounts.list(user_id)
        if account is None and len(existing) >= MAX_ACCOUNTS_PER_USER:
            raise ConflictError("Account limit reached.", code="account_limit_reached")
        await self._verify(user_id, credentials)
        created = account is None
        if account is None:
            name = " ".join((display_name or "").split())[:100] or email_address[:100]
            account = await self._accounts.add(
                user_id=user_id,
                provider=ProviderKind.IMAP,
                email_address=email_address,
                display_name=name,
                color=ACCOUNT_COLORS[len(existing) % len(ACCOUNT_COLORS)],
            )
        await self._store_password(user_id, account, credentials, created=created)
        return account, created

    async def update_password(
        self, user_id: uuid.UUID, account_id: uuid.UUID, password: str
    ) -> EmailAccount:
        """Reconnect a password-based mailbox with a new password; servers stay as stored."""
        account = await self._accounts.get(user_id, account_id)
        if account is None or self._registry.capabilities(account.provider).oauth:
            raise NotFoundError
        try:
            found = await self._vault.read(
                user_id=user_id, account_id=account.id, kind=CredentialKind.IMAP_PASSWORD
            )
            stored = secret_to_server_credentials(found[0]) if found else None
        except VaultError:
            stored = None
        if stored is None:
            # Nothing usable is stored: the mailbox has to be connected again in full.
            raise ConflictError("Connect this mailbox again.", code="credentials_missing")
        credentials = ServerCredentials(stored.imap, stored.smtp, stored.username, password)
        await self._verify(user_id, credentials)
        await self._store_password(user_id, account, credentials, created=False)
        return account

    async def _store_password(
        self,
        user_id: uuid.UUID,
        account: EmailAccount,
        credentials: ServerCredentials,
        *,
        created: bool,
    ) -> None:
        await self._vault.store(
            user_id=user_id,
            account_id=account.id,
            kind=CredentialKind.IMAP_PASSWORD,
            secret=server_credentials_to_secret(credentials),
        )
        await self._accounts.set_status(user_id, account.id, AccountStatus.ACTIVE, None)
        account.status, account.status_reason = AccountStatus.ACTIVE, None
        await self._sync.request(user_id, account.id)
        await self._audit.record(
            "account.connected" if created else "account.reconnected",
            user_id=user_id,
            metadata={"provider": ProviderKind.IMAP.value},
        )

    async def _revoke_quietly(self, provider: ProviderKind, secret: dict[str, str | None]) -> None:
        try:
            await self._registry.oauth_client(provider).revoke_credentials(
                secret_to_credentials(dict(secret), None)
            )
        except ProviderError:
            pass


class AccountService:
    def __init__(
        self,
        accounts: AccountRepository,
        vault: TokenVault,
        registry: ProviderRegistry,
        audit: AuditLog,
        clock: Clock,
    ) -> None:
        self._accounts = accounts
        self._vault = vault
        self._registry = registry
        self._audit = audit
        self._clock = clock

    async def list(self, user_id: uuid.UUID) -> list[EmailAccount]:
        return await self._accounts.list(user_id)

    async def get(self, user_id: uuid.UUID, account_id: uuid.UUID) -> EmailAccount:
        account = await self._accounts.get(user_id, account_id)
        if account is None:
            raise NotFoundError
        return account

    async def update(
        self,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        *,
        display_name: str | None,
        color: str | None,
    ) -> EmailAccount:
        await self.get(user_id, account_id)
        if color is not None:
            color = normalize_color(color)
            if color is None:
                raise InvalidInputError(problems=[FieldProblem("color", "unsupported")])
        name = " ".join(display_name.split())[:100] if display_name is not None else None
        if display_name is not None and not name:
            raise InvalidInputError(problems=[FieldProblem("display_name", "required")])
        await self._accounts.update(user_id, account_id, display_name=name, color=color)
        return await self.get(user_id, account_id)

    async def set_avatar(
        self, user_id: uuid.UUID, account_id: uuid.UUID, content: bytes
    ) -> EmailAccount:
        """Replace the account picture. The type is taken from the bytes, never the upload."""
        await self.get(user_id, account_id)
        if len(content) > MAX_AVATAR_BYTES:
            raise PayloadTooLargeError("The picture exceeds the size limit.")
        media_type = avatar_media_type(content)
        if media_type is None:
            raise InvalidInputError(problems=[FieldProblem("file", "unsupported_type")])
        await self._accounts.set_avatar(
            user_id, account_id, (media_type, content), self._clock.now()
        )
        return await self.get(user_id, account_id)

    async def remove_avatar(self, user_id: uuid.UUID, account_id: uuid.UUID) -> EmailAccount:
        await self.get(user_id, account_id)
        await self._accounts.set_avatar(user_id, account_id, None, self._clock.now())
        return await self.get(user_id, account_id)

    async def avatar(self, user_id: uuid.UUID, account_id: uuid.UUID) -> tuple[str, bytes]:
        found = await self._accounts.get_avatar(user_id, account_id)
        if found is None:
            raise NotFoundError
        return found

    async def disconnect(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        """Revoke the provider grant (best effort), then delete credentials and all mail data.

        Deletion always happens, even when the provider cannot be reached, so no usable
        credential is ever left behind on our side.
        """
        account = await self.get(user_id, account_id)
        revoked = await self._revoke(account)
        await self._vault.delete(user_id=user_id, account_id=account_id)
        await self._accounts.delete(user_id, account_id)  # cascades to mail data
        await self._audit.record(
            "account.disconnected",
            user_id=user_id,
            metadata={"provider": account.provider.value, "revoked_at_provider": revoked},
        )

    async def _revoke(self, account: EmailAccount) -> bool:
        try:
            found = await self._vault.read(
                user_id=account.user_id, account_id=account.id, kind=CredentialKind.OAUTH_TOKENS
            )
            if found is None:
                return False
            await self._registry.oauth_client(account.provider).revoke_credentials(
                secret_to_credentials(*found)
            )
            return True
        except (ProviderError, VaultError):
            return False

    async def disconnect_all(self, user_id: uuid.UUID) -> None:
        for account in await self._accounts.list(user_id):
            await self.disconnect(user_id, account.id)
