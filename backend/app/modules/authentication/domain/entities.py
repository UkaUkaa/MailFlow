"""Authentication domain objects and policies."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from app.shared.domain.errors import FieldProblem, InvalidInputError

PASSWORD_MIN_LENGTH = 10
PASSWORD_MAX_LENGTH = 128


class OneTimeTokenKind(StrEnum):
    EMAIL_VERIFICATION = "email_verification"
    PASSWORD_RESET = "password_reset"


@dataclass(frozen=True, slots=True)
class AuthContext:
    """The authenticated principal of a request. Derived only from the session cookie."""

    user_id: uuid.UUID
    session_id: uuid.UUID


@dataclass(slots=True)
class Session:
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    user_agent: str | None
    ip_address: str | None

    def is_valid(self, now: datetime, idle_timeout: timedelta) -> bool:
        return (
            self.revoked_at is None
            and now < self.expires_at
            and now - self.last_seen_at < idle_timeout
        )


def validate_password(password: str, *, field: str = "password") -> None:
    if len(password) < PASSWORD_MIN_LENGTH:
        raise InvalidInputError(problems=[FieldProblem(field, "password_too_short")])
    if len(password) > PASSWORD_MAX_LENGTH:
        raise InvalidInputError(problems=[FieldProblem(field, "password_too_long")])
    if password.strip() != password or not password.strip():
        raise InvalidInputError(problems=[FieldProblem(field, "password_whitespace")])


class SignInProviderKind(StrEnum):
    """External identity providers that can sign a user in to MailFlow itself.

    Unrelated to mailbox providers: signing in proves who the MailFlow user is and never
    grants access to mail.
    """

    GOOGLE = "google"


@dataclass(frozen=True, slots=True)
class ExternalIdentity:
    """A user identity asserted by an external provider after a completed sign-in."""

    provider: SignInProviderKind
    subject: str  # stable provider account id (OIDC ``sub``); never the e-mail address
    email: str
    email_verified: bool
    display_name: str


class ExternalSignInError(Exception):
    """The provider rejected the exchange or returned an unusable identity."""
