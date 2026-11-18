"""Chooses the adapter for the provider the user connected. Hosts are fixed constants in the
adapters (never user input), so no SSRF guard is needed; redirects are not followed."""

from __future__ import annotations

import httpx

from app.modules.assistant.application import ReplyWriter
from app.modules.assistant.domain import AiProvider
from app.modules.assistant.infrastructure import claude_writer, gemini_writer, openai_writer


def build_ai_http_client(timeout_seconds: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(timeout_seconds, connect=10.0), follow_redirects=False
    )


class HttpAiGateway:
    def __init__(self, http: httpx.AsyncClient, timeout_seconds: float) -> None:
        self._http = http
        self._timeout = timeout_seconds

    async def list_models(self, provider: AiProvider, api_key: str) -> list[str]:
        match provider:
            case AiProvider.OPENAI:
                return await openai_writer.list_models(self._http, api_key)
            case AiProvider.GEMINI:
                return await gemini_writer.list_models(self._http, api_key)
            case AiProvider.ANTHROPIC:
                return await claude_writer.list_models(api_key, self._timeout)

    def writer(self, provider: AiProvider, api_key: str, model: str) -> ReplyWriter:
        match provider:
            case AiProvider.OPENAI:
                return openai_writer.OpenAiWriter(self._http, api_key, model)
            case AiProvider.GEMINI:
                return gemini_writer.GeminiWriter(self._http, api_key, model)
            case AiProvider.ANTHROPIC:
                return claude_writer.ClaudeWriter(api_key, model, self._timeout)
