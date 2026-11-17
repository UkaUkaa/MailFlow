"""Maps provider kinds to adapters. Built once per process in the composition roots."""

from __future__ import annotations

import httpx

from app.core.config import Settings
from app.integrations.email_providers.contracts.errors import ProviderUnsupported
from app.integrations.email_providers.contracts.models import (
    Credentials,
    ProviderCapabilities,
    ProviderKind,
    ServerCredentials,
)
from app.integrations.email_providers.contracts.provider import EmailProvider, OAuthClient
from app.integrations.email_providers.gmail.oauth import GoogleOAuthClient
from app.integrations.email_providers.gmail.provider import GMAIL_CAPABILITIES, GmailProvider
from app.integrations.email_providers.imap import IMAP_CAPABILITIES, ImapProvider, MailConnector
from app.integrations.email_providers.outlook.oauth import MicrosoftOAuthClient
from app.integrations.email_providers.outlook.provider import (
    MAX_CONCURRENT_REQUESTS,
    OUTLOOK_CAPABILITIES,
    OutlookProvider,
)


class DefaultProviderRegistry:
    def __init__(
        self, settings: Settings, client: httpx.AsyncClient, *, background: bool = False
    ) -> None:
        self._settings = settings
        self._client = client
        # Workers pace themselves inside a share of the provider quota and may wait; the API
        # process serves a person, so it does not pace and gives up quickly instead.
        self._background = background
        self._mail = MailConnector(
            connect_timeout=settings.mail_connect_timeout_seconds,
            io_timeout=settings.mail_io_timeout_seconds,
            # Both are refused by Settings unless ENVIRONMENT=test.
            allow_private_networks=settings.ssrf_allow_private_networks,
            extra_ca_file=settings.mail_tls_ca_file,
        )

    def is_available(self, kind: ProviderKind) -> bool:
        # Implemented *and* configured. IMAP needs no server-side configuration: the user
        # supplies the servers, and every connection goes through the SSRF guard.
        if kind is ProviderKind.IMAP:
            return True
        if kind is ProviderKind.GMAIL:
            return self._settings.gmail_configured
        if kind is ProviderKind.OUTLOOK:
            return self._settings.outlook_configured
        return False

    def capabilities(self, kind: ProviderKind) -> ProviderCapabilities:
        return {
            ProviderKind.GMAIL: GMAIL_CAPABILITIES,
            ProviderKind.OUTLOOK: OUTLOOK_CAPABILITIES,
            ProviderKind.IMAP: IMAP_CAPABILITIES,
        }[kind]

    def oauth_client(self, kind: ProviderKind) -> OAuthClient:
        if kind is ProviderKind.GMAIL:
            return GoogleOAuthClient(
                self._client,
                client_id=self._settings.google_client_id,
                client_secret=self._settings.google_client_secret.get_secret_value(),
                redirect_uri=self._settings.gmail_redirect_uri,
            )
        if kind is ProviderKind.OUTLOOK:
            return MicrosoftOAuthClient(
                self._client,
                client_id=self._settings.microsoft_client_id,
                client_secret=self._settings.microsoft_client_secret.get_secret_value(),
                redirect_uri=self._settings.outlook_redirect_uri,
                tenant=self._settings.microsoft_tenant,
            )
        raise ProviderUnsupported(kind.value)

    def provider(
        self, kind: ProviderKind, credentials: Credentials | ServerCredentials
    ) -> EmailProvider:
        if isinstance(credentials, ServerCredentials):
            if kind is not ProviderKind.IMAP:
                raise ProviderUnsupported(kind.value)
            return ImapProvider(self._mail, credentials)
        if kind is ProviderKind.GMAIL:
            return GmailProvider(
                self._client,
                credentials,
                max_concurrency=self._settings.provider_max_concurrency,
                units_per_minute=(
                    self._settings.gmail_sync_units_per_minute if self._background else None
                ),
                max_attempts=4 if self._background else 2,
            )
        if kind is ProviderKind.OUTLOOK:
            # Graph allows four concurrent requests per application and mailbox. A worker
            # takes at most half of them and paces itself; a person's request is not paced.
            concurrency = min(self._settings.provider_max_concurrency, MAX_CONCURRENT_REQUESTS)
            return OutlookProvider(
                self._client,
                credentials,
                max_concurrency=min(concurrency, 2) if self._background else concurrency,
                requests_per_minute=(
                    self._settings.outlook_sync_requests_per_minute if self._background else None
                ),
                max_attempts=4 if self._background else 2,
            )
        raise ProviderUnsupported(kind.value)

    async def verify_credentials(self, kind: ProviderKind, credentials: ServerCredentials) -> None:
        if kind is not ProviderKind.IMAP:
            raise ProviderUnsupported(kind.value)
        await self._mail.verify(credentials)


def build_provider_http_client(settings: Settings) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(settings.provider_http_timeout_seconds, connect=5.0),
        limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
        follow_redirects=False,
    )
