"""Connected mailbox aggregate."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from app.integrations.email_providers.contracts import ProviderKind

# Default identification hues, handed out in turn to newly connected mailboxes. The user may
# replace them with any colour; the frontend keeps the same list (account-colors.ts).
ACCOUNT_COLORS = (
    "#3355e0",
    "#0e8f8f",
    "#1f8a4c",
    "#a86a00",
    "#c2513a",
    "#b8388a",
    "#7a4fd6",
    "#5d6577",
)
MAX_ACCOUNTS_PER_USER = 10

_HEX_COLOR = re.compile(r"#[0-9a-f]{6}")

# Account pictures are small identification marks, downscaled by the browser before upload.
MAX_AVATAR_BYTES = 128 * 1024
_AVATAR_SIGNATURES: tuple[tuple[str, bytes, int], ...] = (
    ("image/png", b"\x89PNG\r\n\x1a\n", 0),
    ("image/jpeg", b"\xff\xd8\xff", 0),
    ("image/webp", b"WEBP", 8),
)


def normalize_color(value: str) -> str | None:
    """``#rrggbb`` in lower case, or ``None`` when the value is not such a colour."""
    candidate = value.strip().lower()
    return candidate if _HEX_COLOR.fullmatch(candidate) else None


def avatar_media_type(content: bytes) -> str | None:
    """The image type recognised from the file's own bytes; the declared type is ignored.

    Only raster formats a browser shows in ``<img>`` without running anything are accepted:
    PNG, JPEG and WebP. SVG (scriptable) and GIF (animated) are refused.
    """
    for media_type, signature, offset in _AVATAR_SIGNATURES:
        if content[offset : offset + len(signature)] == signature:
            if media_type == "image/webp" and content[:4] != b"RIFF":
                continue
            return media_type
    return None


class AccountStatus(StrEnum):
    ACTIVE = "active"
    NEEDS_REAUTH = "needs_reauth"
    ERROR = "error"
    DISABLED = "disabled"


@dataclass(slots=True)
class EmailAccount:
    id: uuid.UUID
    user_id: uuid.UUID
    provider: ProviderKind
    email_address: str
    display_name: str
    color: str
    status: AccountStatus
    status_reason: str | None
    created_at: datetime
    avatar_updated_at: datetime | None = None

    @property
    def is_active(self) -> bool:
        return self.status is AccountStatus.ACTIVE


@dataclass(frozen=True, slots=True)
class OAuthState:
    id: uuid.UUID
    user_id: uuid.UUID
    provider: ProviderKind
    sealed_verifier: tuple[str, bytes, bytes]  # key id, nonce, ciphertext
    reconnect_account_id: uuid.UUID | None
    locale: str
