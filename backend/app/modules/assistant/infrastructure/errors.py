"""Provider HTTP failures -> the assistant's domain errors. Response bodies are inspected for a
known reason only and never logged or passed on (they can echo parts of the request)."""

from __future__ import annotations

from app.shared.domain.errors import (
    DomainError,
    InvalidInputError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
    UnsupportedError,
)


def key_rejected() -> DomainError:
    return InvalidInputError("The AI provider rejected this key.", code="assistant_key_invalid")


def from_status(status: int, body: str = "") -> DomainError:
    if status in (401, 403) or (status == 400 and "API_KEY_INVALID" in body):
        return key_rejected()
    if status == 404:
        return InvalidInputError(
            "This model is not available for your key.", code="assistant_model_unavailable"
        )
    if status == 429:
        # Includes "out of credit / quota" at every provider.
        return ProviderRateLimitedError(code="assistant_rate_limited")
    if 400 <= status < 500:
        return UnsupportedError(
            "This model cannot write replies. Choose another one.",
            code="assistant_model_unsupported",
        )
    return ProviderUnavailableError(code="assistant_unavailable")


def refused() -> DomainError:
    return UnsupportedError("The assistant declined this request.", code="assistant_refused")


def unavailable() -> DomainError:
    return ProviderUnavailableError(code="assistant_unavailable")
