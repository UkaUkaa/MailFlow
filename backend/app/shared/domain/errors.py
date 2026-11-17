"""Domain error hierarchy. Mapped to HTTP responses in ``app.core.exceptions``."""

from __future__ import annotations

from dataclasses import dataclass


class DomainError(Exception):
    code = "domain_error"
    default_message = "The request could not be processed."

    def __init__(self, message: str | None = None, *, code: str | None = None) -> None:
        super().__init__(message or self.default_message)
        self.message = message or self.default_message
        if code:
            self.code = code


class NotFoundError(DomainError):
    code = "not_found"
    default_message = "Resource not found."


class ConflictError(DomainError):
    code = "conflict"
    default_message = "The resource is in a conflicting state."


@dataclass(frozen=True, slots=True)
class FieldProblem:
    field: str
    code: str


class InvalidInputError(DomainError):
    code = "validation_error"
    default_message = "The submitted data is invalid."

    def __init__(
        self,
        message: str | None = None,
        *,
        problems: list[FieldProblem] | None = None,
        code: str | None = None,
    ) -> None:
        super().__init__(message, code=code)
        self.problems = problems or []


class UnauthenticatedError(DomainError):
    code = "unauthenticated"
    default_message = "Authentication is required."


class InvalidCredentialsError(DomainError):
    code = "invalid_credentials"
    default_message = "Incorrect email or password."


class EmailNotVerifiedError(DomainError):
    code = "email_not_verified"
    default_message = "Verify your email address before signing in."


class ForbiddenError(DomainError):
    code = "forbidden"
    default_message = "You are not allowed to do this."


class UnsupportedError(DomainError):
    code = "unsupported"
    default_message = "This operation is not supported for this account."


class PayloadTooLargeError(DomainError):
    code = "payload_too_large"
    default_message = "The request is too large."


class RateLimitedError(DomainError):
    code = "rate_limited"
    default_message = "Too many requests. Try again later."

    def __init__(self, retry_after: int) -> None:
        super().__init__()
        self.retry_after = max(1, retry_after)


class ProviderAuthRequiredError(DomainError):
    code = "provider_auth_required"
    default_message = "The mailbox must be reconnected."


class ProviderNotConfiguredError(DomainError):
    code = "provider_not_configured"
    default_message = "This email provider is not configured on the server."


class ProviderUnavailableError(DomainError):
    code = "provider_unavailable"
    default_message = "The email provider is temporarily unavailable."


class ProviderRateLimitedError(DomainError):
    code = "provider_rate_limited"
    default_message = "The email provider is rate limiting requests. Try again shortly."
