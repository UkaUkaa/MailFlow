"""Google Gemini over the REST API (generateContent with a JSON response schema).

The key travels in the ``x-goog-api-key`` header, never in the URL, so it cannot end up in
access logs or error messages that quote the URL.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.core.logging import get_logger
from app.modules.assistant.domain import ReplyDraft, ReplyRequest
from app.modules.assistant.infrastructure import errors
from app.modules.assistant.infrastructure.prompt import (
    MAX_OUTPUT_TOKENS,
    SYSTEM_PROMPT,
    build_prompt,
    parse_output,
)

logger = get_logger(__name__)
BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
_EXCLUDED = ("embedding", "image", "tts", "audio", "live", "aqa", "gemini-1.0")

_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "language": {"type": "STRING"},
        "subject": {"type": "STRING"},
        "body": {"type": "STRING"},
    },
    "required": ["language", "subject", "body"],
}
_BLOCKED = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"}


def _headers(api_key: str) -> dict[str, str]:
    return {"x-goog-api-key": api_key}


async def _send(http: httpx.AsyncClient, method: str, url: str, **kwargs: Any) -> httpx.Response:
    try:
        response = await http.request(method, url, **kwargs)
    except httpx.HTTPError as exc:
        logger.warning("assistant_request_failed", provider="gemini", error=type(exc).__name__)
        raise errors.unavailable() from exc
    if response.status_code >= 400:
        logger.warning("assistant_provider_error", provider="gemini", status=response.status_code)
        raise errors.from_status(response.status_code, response.text)
    return response


async def list_models(http: httpx.AsyncClient, api_key: str) -> list[str]:
    response = await _send(
        http, "GET", f"{BASE_URL}/models", headers=_headers(api_key), params={"pageSize": 1000}
    )
    names: list[str] = []
    for item in response.json().get("models", []):
        name = str(item.get("name", "")).removeprefix("models/")
        if (
            name.startswith("gemini-")
            and "generateContent" in item.get("supportedGenerationMethods", [])
            and not any(word in name for word in _EXCLUDED)
        ):
            names.append(name)
    # Newest versions first ("gemini-2.5-pro" before "gemini-2.0-flash").
    return sorted(names, reverse=True)


class GeminiWriter:
    def __init__(self, http: httpx.AsyncClient, api_key: str, model: str) -> None:
        self._http = http
        self._key = api_key
        self._model = model

    async def write(self, request: ReplyRequest) -> ReplyDraft:
        body = {
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": build_prompt(request)}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": _SCHEMA,
                "maxOutputTokens": MAX_OUTPUT_TOKENS,
            },
        }
        response = await _send(
            self._http,
            "POST",
            f"{BASE_URL}/models/{self._model}:generateContent",
            headers=_headers(self._key),
            json=body,
        )
        payload = response.json()
        usage = payload.get("usageMetadata") or {}
        candidate = (payload.get("candidates") or [{}])[0]
        finish = candidate.get("finishReason")
        logger.info(
            "assistant_reply_drafted",
            provider="gemini",
            model=self._model,
            finish_reason=finish,
            input_tokens=usage.get("promptTokenCount"),
            output_tokens=usage.get("candidatesTokenCount"),
        )
        if (payload.get("promptFeedback") or {}).get("blockReason") or finish in _BLOCKED:
            raise errors.refused()
        if finish == "MAX_TOKENS":
            raise errors.unavailable()
        parts = (candidate.get("content") or {}).get("parts") or []
        return parse_output("".join(str(p.get("text", "")) for p in parts if not p.get("thought")))
