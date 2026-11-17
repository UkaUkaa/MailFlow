"""Protocols implemented by provider adapters."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.integrations.email_providers.contracts.models import (
    Credentials,
    MessagePage,
    OAuthIdentity,
    OutgoingMessage,
    ProviderCapabilities,
    ProviderDraft,
    ProviderFolder,
    ProviderKind,
    ProviderMessage,
    Relocation,
    SentMessage,
    ServerCredentials,
    SyncChanges,
    ThreadAction,
)


class OAuthClient(Protocol):
    """Authorization-code flow operations. Stateless; holds only the application's client id."""

    def authorization_url(
        self, *, state: str, code_challenge: str, login_hint: str | None = None
    ) -> str: ...

    async def authenticate(self, *, code: str, code_verifier: str) -> Credentials:
        """Exchange an authorization code for credentials."""

    async def refresh_credentials(self, credentials: Credentials) -> Credentials: ...

    async def revoke_credentials(self, credentials: Credentials) -> None: ...

    async def fetch_identity(self, credentials: Credentials) -> OAuthIdentity: ...


class EmailProvider(Protocol):
    """Mailbox operations for one already-authenticated account."""

    @property
    def capabilities(self) -> ProviderCapabilities: ...

    async def list_messages(self, *, page_token: str | None, page_size: int) -> MessagePage: ...

    async def get_message(self, provider_message_id: str) -> ProviderMessage: ...

    async def get_thread(self, provider_thread_id: str) -> list[ProviderMessage]: ...

    async def synchronize(self, cursor: str) -> SyncChanges:
        """Changes since ``cursor``. Raises ``ProviderCursorExpired`` when it is too old."""

    async def list_folders(self) -> list[ProviderFolder]: ...

    async def search_messages(
        self, query: str, *, page_token: str | None, page_size: int
    ) -> MessagePage: ...

    async def send_message(self, message: OutgoingMessage) -> SentMessage: ...

    async def reply_message(self, message: OutgoingMessage) -> SentMessage: ...

    async def forward_message(self, message: OutgoingMessage) -> SentMessage: ...

    async def modify_thread(
        self, provider_thread_id: str, action: ThreadAction
    ) -> tuple[Relocation, ...] | None:
        """Apply ``action``. Returns the messages whose provider id changed, if any."""

    async def modify_message(
        self, provider_message_id: str, action: ThreadAction
    ) -> tuple[Relocation, ...] | None: ...

    async def delete_message(self, provider_message_id: str) -> None:
        """Move a single message to trash (permanent deletion is intentionally not offered)."""

    async def get_attachment(self, provider_message_id: str, part_id: str) -> bytes: ...

    async def create_draft(self, message: OutgoingMessage) -> ProviderDraft: ...

    async def update_draft(
        self, provider_draft_id: str, message: OutgoingMessage
    ) -> ProviderDraft: ...

    async def delete_draft(self, provider_draft_id: str) -> None: ...

    async def send_draft(self, provider_draft_id: str) -> SentMessage: ...


class ProviderRegistry(Protocol):
    def is_available(self, kind: ProviderKind) -> bool:
        """True when the adapter is implemented *and* configured on this server."""

    def capabilities(self, kind: ProviderKind) -> ProviderCapabilities: ...

    def oauth_client(self, kind: ProviderKind) -> OAuthClient: ...

    def provider(
        self, kind: ProviderKind, credentials: Credentials | ServerCredentials
    ) -> EmailProvider: ...

    async def verify_credentials(self, kind: ProviderKind, credentials: ServerCredentials) -> None:
        """Log in to a password-based mailbox's servers and log out again.

        Raises ``ProviderDestinationBlocked``, ``ProviderTlsRequired``, ``ProviderAuthError``
        or ``ProviderUnavailable``; the error's ``service`` attribute (``"imap"`` / ``"smtp"``),
        when set, names the server that failed.
        """


@runtime_checkable
class ClosableProvider(Protocol):
    """Adapters that hold a connection implement this; the session factory closes them."""

    async def aclose(self) -> None: ...
