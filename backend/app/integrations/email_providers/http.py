"""Shared resilient HTTP helper for provider adapters: timeouts, retries, error mapping."""

from __future__ import annotations

import asyncio
import random
import re
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.core.logging import get_logger
from app.integrations.email_providers.contracts.errors import (
    ProviderAuthError,
    ProviderError,
    ProviderNotFound,
    ProviderRateLimited,
    ProviderUnavailable,
)

logger = get_logger(__name__)

RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
MAX_RETRY_AFTER = 30.0
Sleep = Callable[[float], Awaitable[None]]


def _retry_after(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    if value and value.isdigit():
        return min(float(value), MAX_RETRY_AFTER)
    return None


_RATE_LIMIT_REASONS = frozenset(
    {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"}
)


def _error_reasons(response: httpx.Response) -> set[str]:
    """Machine-readable reason codes from a Google-style error body (never message text)."""
    try:
        error = response.json().get("error", {})
        errors = error.get("errors", []) if isinstance(error, dict) else []
    except (ValueError, AttributeError):
        return set()
    return {str(e.get("reason", "")) for e in errors if isinstance(e, dict)}


def _quota_message(response: httpx.Response) -> str:
    """Provider's own description of the exhausted quota (names a limit, never mail data)."""
    try:
        error = response.json().get("error", {})
        return str(error.get("message", ""))[:200] if isinstance(error, dict) else ""
    except (ValueError, AttributeError):
        return ""


def _endpoint(url: str) -> str:
    """Request path with identifiers removed, safe to log."""
    path = httpx.URL(url).path
    return re.sub(r"/[A-Za-z0-9_\-]{12,}", "/{id}", path)


def _is_rate_limit(response: httpx.Response) -> bool:
    if response.status_code == 429:
        return True
    return response.status_code == 403 and bool(_error_reasons(response) & _RATE_LIMIT_REASONS)


class ResilientHttp:
    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        max_attempts: int = 4,
        base_delay: float = 0.5,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        self._client = client
        self._max_attempts = max_attempts
        self._base_delay = base_delay
        self._sleep = sleep

    async def request(
        self,
        method: str,
        url: str,
        *,
        idempotent: bool = True,
        passthrough: frozenset[int] = frozenset(),
        **kwargs: Any,
    ) -> httpx.Response:
        """Perform a request. Non-idempotent calls are retried only when explicitly throttled,
        because a network error after the provider accepted a send could duplicate mail.

        Responses whose status is in ``passthrough`` are returned instead of raised, for the
        rare call where the adapter must read the provider's error code to classify a failure.
        """
        last_rate_limit: float | None = None
        for attempt in range(1, self._max_attempts + 1):
            try:
                response = await self._client.request(method, url, **kwargs)
            except httpx.HTTPError as exc:
                if not idempotent or attempt == self._max_attempts:
                    raise ProviderUnavailable(type(exc).__name__) from exc
                await self._sleep(self._delay(attempt, None))
                continue
            status = response.status_code
            if status < 400 or status in passthrough:
                return response
            rate_limited = _is_rate_limit(response)
            if status == 401 or (status == 403 and not rate_limited):
                raise ProviderAuthError(f"provider rejected credentials ({status})")
            if status in (404, 410):
                raise ProviderNotFound(f"remote object missing ({status})")
            retryable = rate_limited or (idempotent and status in RETRY_STATUSES)
            if retryable and attempt < self._max_attempts:
                last_rate_limit = _retry_after(response)
                await self._sleep(self._delay(attempt, last_rate_limit))
                continue
            if rate_limited:
                logger.warning(
                    "provider_rate_limited",
                    status=status,
                    reasons=sorted(_error_reasons(response)),
                    attempts=attempt,
                    method=method,
                    endpoint=_endpoint(url),
                    quota=_quota_message(response),
                )
                raise ProviderRateLimited(_retry_after(response) or last_rate_limit)
            if status >= 500:
                raise ProviderUnavailable(f"provider error ({status})")
            raise ProviderError(f"provider rejected request ({status})")
        raise ProviderUnavailable("retries exhausted")  # pragma: no cover

    def _delay(self, attempt: int, retry_after: float | None) -> float:
        if retry_after is not None:
            return retry_after
        backoff = self._base_delay * (2 ** (attempt - 1))
        return float(backoff + random.uniform(0, backoff / 2))  # noqa: S311 - jitter, not crypto
