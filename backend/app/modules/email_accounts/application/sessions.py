"""Turns a stored account into a ready-to-use provider adapter with fresh credentials."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.integrations.email_providers.contracts import (
    ClosableProvider,
    Credentials,
    EmailProvider,
    MailEndpoint,
    MailSecurity,
    ProviderAuthError,
    ProviderError,
    ProviderNotFound,
    ProviderRateLimited,
    ProviderRegistry,
    ProviderUnavailable,
    ProviderUnsupported,
    ServerCredentials,
)
from app.modules.email_accounts.application.ports import AccountRepository, AccountStatusMarker
from app.modules.email_accounts.domain import AccountStatus, EmailAccount
from app.modules.token_vault.application import TokenVault
from app.modules.token_vault.domain import CredentialKind, VaultError
from app.shared.application.ports import Clock, DistributedLock
from app.shared.domain.errors import (
    NotFoundError,
    ProviderAuthRequiredError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
    UnsupportedError,
)

REFRESH_MARGIN = timedelta(minutes=2)


@dataclass(frozen=True, slots=True)
class ProviderSession:
    account: EmailAccount
    provider: EmailProvider


def credentials_to_secret(credentials: Credentials) -> dict[str, str | None]:
    return {
        "access_token": credentials.access_token,
        "refresh_token": credentials.refresh_token,
        "scope": credentials.scope,
    }


def secret_to_credentials(secret: dict[str, object], expires_at: datetime | None) -> Credentials:
    refresh = secret.get("refresh_token")
    return Credentials(
        access_token=str(secret.get("access_token", "")),
        refresh_token=str(refresh) if refresh else None,
        expires_at=expires_at,
        scope=str(secret.get("scope", "")),
    )


def server_credentials_to_secret(credentials: ServerCredentials) -> dict[str, object]:
    """Everything needed to reach a password-based mailbox, as ONE vault secret: the hosts
    are encrypted together with the password, so no plain column describes the server."""
    return {
        "imap": [credentials.imap.host, credentials.imap.port, credentials.imap.security.value],
        "smtp": [credentials.smtp.host, credentials.smtp.port, credentials.smtp.security.value],
        "username": credentials.username,
        "password": credentials.password,
    }


def secret_to_server_credentials(secret: dict[str, object]) -> ServerCredentials:
    def endpoint(value: object) -> MailEndpoint:
        if not isinstance(value, list) or len(value) != 3:
            raise VaultError("Stored mail server settings are malformed.")
        host, port, security = value
        return MailEndpoint(str(host), int(port), MailSecurity(str(security)))

    try:
        return ServerCredentials(
            imap=endpoint(secret.get("imap")),
            smtp=endpoint(secret.get("smtp")),
            username=str(secret["username"]),
            password=str(secret["password"]),
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise VaultError("Stored mail server settings are malformed.") from exc


class ProviderSessionFactory:
    def __init__(
        self,
        accounts: AccountRepository,
        vault: TokenVault,
        registry: ProviderRegistry,
        lock: DistributedLock,
        status: AccountStatusMarker,
        clock: Clock,
    ) -> None:
        self._accounts = accounts
        self._vault = vault
        self._registry = registry
        self._lock = lock
        self._status = status
        self._clock = clock

    async def get_account(self, user_id: uuid.UUID, account_id: uuid.UUID) -> EmailAccount:
        account = await self._accounts.get(user_id, account_id)
        if account is None:
            raise NotFoundError
        return account

    async def _read(self, account: EmailAccount) -> Credentials | None:
        found = await self._vault.read(
            user_id=account.user_id, account_id=account.id, kind=CredentialKind.OAUTH_TOKENS
        )
        return secret_to_credentials(*found) if found else None

    async def _server_credentials(self, account: EmailAccount) -> ServerCredentials:
        found = await self._vault.read(
            user_id=account.user_id, account_id=account.id, kind=CredentialKind.IMAP_PASSWORD
        )
        if found is None:
            raise ProviderAuthError("no stored credentials")
        return secret_to_server_credentials(found[0])

    def _fresh(self, credentials: Credentials) -> bool:
        return (
            credentials.expires_at is not None
            and credentials.expires_at - self._clock.now() > REFRESH_MARGIN
        )

    async def _credentials(self, account: EmailAccount) -> Credentials:
        credentials = await self._read(account)
        if credentials is None:
            raise ProviderAuthError("no stored credentials")
        if self._fresh(credentials):
            return credentials
        key = f"mf:u:{account.user_id}:acct:{account.id}:refresh"
        async with self._lock.acquire(key, ttl_seconds=30, wait_seconds=10):
            # Another worker may have refreshed while we waited for the lock.
            latest = await self._read(account) or credentials
            if self._fresh(latest):
                return latest
            refreshed = await self._registry.oauth_client(account.provider).refresh_credentials(
                latest
            )
            await self._vault.store(
                user_id=account.user_id,
                account_id=account.id,
                kind=CredentialKind.OAUTH_TOKENS,
                secret=credentials_to_secret(refreshed),
                expires_at=refreshed.expires_at,
            )
            return refreshed

    @asynccontextmanager
    async def open(
        self, user_id: uuid.UUID, account_id: uuid.UUID
    ) -> AsyncIterator[ProviderSession]:
        """Yield an authenticated adapter; provider failures become domain errors.

        The account is looked up by ``(account_id, user_id)``: an account of another tenant
        is indistinguishable from a missing one.
        """
        account = await self.get_account(user_id, account_id)
        if account.status is AccountStatus.NEEDS_REAUTH:
            raise ProviderAuthRequiredError
        if not account.is_active:
            raise UnsupportedError("This account is not active.")
        provider: EmailProvider | None = None
        try:
            credentials: Credentials | ServerCredentials
            if self._registry.capabilities(account.provider).oauth:
                credentials = await self._credentials(account)
            else:
                # Password-based mailbox: nothing to refresh. A rejected login surfaces as
                # ProviderAuthError from the adapter and marks the account below.
                credentials = await self._server_credentials(account)
            provider = self._registry.provider(account.provider, credentials)
            yield ProviderSession(account, provider)
        except ProviderAuthError as exc:
            await self._status.mark(
                user_id, account_id, AccountStatus.NEEDS_REAUTH, "authorization_revoked"
            )
            raise ProviderAuthRequiredError from exc
        except ProviderRateLimited as exc:
            raise ProviderRateLimitedError from exc
        except ProviderNotFound as exc:
            raise NotFoundError("The item no longer exists in the mailbox.") from exc
        except ProviderUnsupported as exc:
            raise UnsupportedError from exc
        except (ProviderUnavailable, ProviderError) as exc:
            raise ProviderUnavailableError from exc
        finally:
            if isinstance(provider, ClosableProvider):
                try:
                    await provider.aclose()
                except Exception:  # noqa: S110 - closing a connection must never mask the result
                    pass
