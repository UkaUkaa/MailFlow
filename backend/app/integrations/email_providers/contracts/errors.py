from __future__ import annotations


class ProviderError(Exception):
    """Base class for provider failures. Messages never contain credentials or mail content."""

    # For providers with more than one server ("imap" / "smtp"): which one failed.
    service: str | None = None


class ProviderAuthError(ProviderError):
    """The grant is invalid, revoked or lacks scope: the user must reconnect."""


class ProviderRateLimited(ProviderError):  # noqa: N818
    def __init__(self, retry_after: float | None = None) -> None:
        super().__init__("provider rate limit")
        self.retry_after = retry_after


class ProviderNotFound(ProviderError):  # noqa: N818
    """The referenced remote object no longer exists."""


class ProviderCursorExpired(ProviderError):  # noqa: N818
    """The incremental sync cursor is too old; a full resynchronization is required."""


class ProviderUnavailable(ProviderError):  # noqa: N818
    """Transient provider or network failure after retries."""


class ProviderUnsupported(ProviderError):  # noqa: N818
    """The provider does not implement the requested operation."""


class ProviderTlsRequired(ProviderError):  # noqa: N818
    """The mail server does not offer an encrypted connection; nothing was sent to it."""


class ProviderDestinationBlocked(ProviderError):  # noqa: N818
    """The server address is not allowed (not publicly routable, or a disallowed port)."""
