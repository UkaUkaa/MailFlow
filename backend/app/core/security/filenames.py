"""Attachment filename and MIME hygiene."""

from __future__ import annotations

import re
import unicodedata
from urllib.parse import quote

_UNSAFE = re.compile(r'[\x00-\x1f\x7f<>:"/\\|?*]+')
_WINDOWS_RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$", re.I)
_MIME = re.compile(r"^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$", re.I)
MAX_FILENAME_LENGTH = 180


def sanitize_filename(name: str | None, fallback: str = "attachment") -> str:
    """Strip path components, control characters and reserved names. Never returns empty."""
    value = unicodedata.normalize("NFC", name or "")
    value = value.replace("\\", "/").split("/")[-1]
    value = _UNSAFE.sub("_", value).strip(" .")
    if not value or value in {".", ".."} or _WINDOWS_RESERVED.match(value):
        value = fallback
    if len(value) > MAX_FILENAME_LENGTH:
        stem, dot, ext = value.rpartition(".")
        if dot and len(ext) <= 10:
            value = stem[: MAX_FILENAME_LENGTH - len(ext) - 1] + "." + ext
        else:
            value = value[:MAX_FILENAME_LENGTH]
    return value


def normalize_mime_type(value: str | None) -> str:
    candidate = (value or "").split(";")[0].strip().lower()
    return candidate if _MIME.match(candidate) else "application/octet-stream"


def content_disposition_attachment(filename: str) -> str:
    """RFC 6266 header value that always forces a download."""
    safe = sanitize_filename(filename)
    ascii_name = safe.encode("ascii", "replace").decode().replace('"', "_").replace("?", "_")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(safe, safe='')}"
