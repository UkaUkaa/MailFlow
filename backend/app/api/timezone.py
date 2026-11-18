"""The user's time zone, as reported by their browser in the ``mf_tz`` cookie.

The client sets the cookie from where the person is (``Intl`` time zone of the device). A time
the user picks is sent as local wall-clock time and converted here to the server's time (UTC).
The cookie is a display preference of the caller, not an identity: it is validated against the
IANA database and used only to interpret that caller's own input.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import unquote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Cookie

from app.shared.domain.errors import FieldProblem, InvalidInputError

TZ_COOKIE = "mf_tz"
TimeZoneCookie = Annotated[str | None, Cookie(alias=TZ_COOKIE, max_length=64)]


def _zone(name: str | None) -> ZoneInfo | None:
    if not name:
        return None
    # The browser writes the cookie with ``encodeURIComponent`` ("Europe%2FKyiv"); cookie
    # parsing does not percent-decode, so decode here.
    name = unquote(name)
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return None


def to_server_time(value: datetime, time_zone: str | None, *, field: str = "send_at") -> datetime:
    """Convert a user-picked moment to UTC.

    A value that carries its own UTC offset is taken as is. A local wall-clock value is read in
    the caller's time zone; without a valid zone it cannot be placed on the timeline and is
    rejected. A wall time that occurs twice (clocks going back) means its first occurrence.
    """
    if value.tzinfo is not None:
        return value.astimezone(UTC)
    zone = _zone(time_zone)
    if zone is None:
        raise InvalidInputError(problems=[FieldProblem(field, "timezone_required")])
    return value.replace(tzinfo=zone).astimezone(UTC)
