"""Opaque keyset cursors."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime

from app.shared.domain.errors import InvalidInputError

DEFAULT_LIMIT = 30
MAX_LIMIT = 100


@dataclass(frozen=True, slots=True)
class Page[T]:
    items: list[T]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class KeysetCursor:
    """Position after the row with (``at``, ``id``) in a ``ORDER BY at DESC, id DESC`` listing."""

    at: datetime
    id: str

    def encode(self) -> str:
        raw = json.dumps({"a": self.at.isoformat(), "i": self.id}).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    @staticmethod
    def decode(value: str | None) -> KeysetCursor | None:
        if not value:
            return None
        try:
            padded = value + "=" * (-len(value) % 4)
            data = json.loads(base64.urlsafe_b64decode(padded.encode()))
            return KeysetCursor(at=datetime.fromisoformat(data["a"]), id=str(data["i"]))
        except (ValueError, KeyError, TypeError) as exc:
            raise InvalidInputError("Invalid cursor.") from exc


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(limit, MAX_LIMIT))
