"""Structured logging with redaction of sensitive keys."""

from __future__ import annotations

import logging
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog

_SENSITIVE = (
    "password", "token", "secret", "authorization", "cookie", "credential", "code_verifier",
    "body", "ciphertext", "api_key", "set-cookie",
)  # fmt: skip


def _redact(_: object, __: str, event_dict: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    for key in list(event_dict):
        lowered = key.lower()
        if any(marker in lowered for marker in _SENSITIVE):
            event_dict[key] = "[redacted]"
    return event_dict


def configure_logging(level: str = "INFO", *, json: bool = True) -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level.upper())
    renderer: Any = structlog.processors.JSONRenderer() if json else structlog.dev.ConsoleRenderer()
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _redact,
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level.upper())),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> Any:
    return structlog.get_logger(name)
