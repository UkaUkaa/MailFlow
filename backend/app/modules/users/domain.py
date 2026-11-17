"""User aggregate."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class UserStatus(StrEnum):
    ACTIVE = "active"
    DEACTIVATED = "deactivated"
    DELETING = "deleting"


@dataclass(slots=True)
class User:
    id: uuid.UUID
    email: str
    display_name: str
    password_hash: str
    status: UserStatus
    email_verified_at: datetime | None
    created_at: datetime

    @property
    def is_active(self) -> bool:
        return self.status is UserStatus.ACTIVE

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None


def normalize_email(email: str) -> str:
    return email.strip().lower()


def normalize_display_name(name: str) -> str:
    return " ".join(name.split())[:100]
