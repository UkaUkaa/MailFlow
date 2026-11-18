"""Anthropic Claude through the official Python SDK, with the user's own key."""

from __future__ import annotations

from typing import Any

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from app.core.logging import get_logger
from app.modules.assistant.domain import ReplyDraft, ReplyRequest
from app.modules.assistant.infrastructure import errors
from app.modules.assistant.infrastructure.prompt import (
    MAX_OUTPUT_TOKENS,
    OUTPUT_SCHEMA,
    SYSTEM_PROMPT,
    build_prompt,
    parse_output,
)

logger = get_logger(__name__)

# Server-side refusal fallback exists for these models; elsewhere the parameter is rejected.
_FALLBACK_MODELS = frozenset(
    {
        "claude-fable-5-2",
        "claude-fable-5-1",
        "claude-opus-5-5",
        "claude-opus-5",
        "claude-sonnet-5-5",
    }
)
_FALLBACK_BETA = "server-side-fallback-2026-07-01"


def _client(api_key: str, timeout_seconds: float) -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=api_key, timeout=timeout_seconds, max_retries=1)


def _error(exc: Exception) -> Exception:
    if isinstance(exc, anthropic.APIStatusError):
        logger.warning("assistant_provider_error", provider="anthropic", status=exc.status_code)
        return errors.from_status(exc.status_code)
    logger.warning("assistant_request_failed", provider="anthropic", error=type(exc).__name__)
    return errors.unavailable()


async def list_models(api_key: str, timeout_seconds: float) -> list[str]:
    try:
        async with _client(api_key, timeout_seconds) as client:
            # Newest first; Claude 3 models have no structured output.
            return [
                m.id async for m in client.models.list(limit=100) if not m.id.startswith("claude-3")
            ]
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
        raise _error(exc) from exc


class ClaudeWriter:
    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        self._key = api_key
        self._model = model
        self._timeout = timeout_seconds

    async def write(self, request: ReplyRequest) -> ReplyDraft:
        output_config: BetaOutputConfigParam = {
            "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA},
        }
        messages: list[BetaMessageParam] = [{"role": "user", "content": build_prompt(request)}]
        extra: dict[str, Any] = {}
        if self._model in _FALLBACK_MODELS:
            extra = {"betas": [_FALLBACK_BETA], "fallbacks": "default"}
        try:
            async with _client(self._key, self._timeout) as client:
                response = await client.beta.messages.create(
                    model=self._model,
                    max_tokens=MAX_OUTPUT_TOKENS,
                    output_config=output_config,
                    system=SYSTEM_PROMPT,
                    messages=messages,
                    **extra,
                )
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
            raise _error(exc) from exc

        logger.info(
            "assistant_reply_drafted",
            provider="anthropic",
            model=response.model,
            finish_reason=response.stop_reason,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )
        if response.stop_reason == "refusal":
            raise errors.refused()
        if response.stop_reason == "max_tokens":
            raise errors.unavailable()
        return parse_output("".join(b.text for b in response.content if b.type == "text"))
