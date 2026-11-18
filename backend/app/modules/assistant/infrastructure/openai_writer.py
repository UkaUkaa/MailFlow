"""OpenAI (ChatGPT models) over the REST API: Chat Completions with a strict JSON schema."""

from __future__ import annotations

from typing import Any

import httpx

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
BASE_URL = "https://api.openai.com/v1"

# Chat models that support structured output. Audio, image, search, embedding, moderation and
# older completion models are left out of the list the user picks from.
_PREFIXES = ("gpt-4o", "gpt-4.1", "gpt-5", "o1", "o3", "o4", "chatgpt-")
_EXCLUDED = ("audio", "realtime", "tts", "transcribe", "image", "search", "embedding", "codex",
             "instruct", "moderation", "deep-research")  # fmt: skip


def _headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


async def _send(http: httpx.AsyncClient, method: str, url: str, **kwargs: Any) -> httpx.Response:
    try:
        response = await http.request(method, url, **kwargs)
    except httpx.HTTPError as exc:
        logger.warning("assistant_request_failed", provider="openai", error=type(exc).__name__)
        raise errors.unavailable() from exc
    if response.status_code >= 400:
        logger.warning("assistant_provider_error", provider="openai", status=response.status_code)
        raise errors.from_status(response.status_code, response.text)
    return response


async def list_models(http: httpx.AsyncClient, api_key: str) -> list[str]:
    response = await _send(http, "GET", f"{BASE_URL}/models", headers=_headers(api_key))
    items = response.json().get("data", [])
    usable = [
        item for item in items
        if isinstance(item.get("id"), str)
        and item["id"].startswith(_PREFIXES)
        and not any(word in item["id"] for word in _EXCLUDED)
    ]  # fmt: skip
    usable.sort(key=lambda item: item.get("created", 0), reverse=True)
    return [item["id"] for item in usable]


class OpenAiWriter:
    def __init__(self, http: httpx.AsyncClient, api_key: str, model: str) -> None:
        self._http = http
        self._key = api_key
        self._model = model

    async def write(self, request: ReplyRequest) -> ReplyDraft:
        body = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_prompt(request)},
            ],
            "max_completion_tokens": MAX_OUTPUT_TOKENS,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "reply", "strict": True, "schema": OUTPUT_SCHEMA},
            },
        }
        response = await _send(
            self._http,
            "POST",
            f"{BASE_URL}/chat/completions",
            headers=_headers(self._key),
            json=body,
        )
        payload = response.json()
        choice = (payload.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        usage = payload.get("usage") or {}
        logger.info(
            "assistant_reply_drafted",
            provider="openai",
            model=payload.get("model"),
            finish_reason=choice.get("finish_reason"),
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
        )
        if message.get("refusal") or choice.get("finish_reason") == "content_filter":
            raise errors.refused()
        if choice.get("finish_reason") == "length":
            raise errors.unavailable()
        return parse_output(message.get("content") or "")
