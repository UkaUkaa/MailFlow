"""Argon2id password hashing."""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from argon2.low_level import Type


class Argon2PasswordHasher:
    """Argon2id with the library's current recommended (RFC 9106 low-memory) parameters."""

    def __init__(self) -> None:
        self._hasher = PasswordHasher(type=Type.ID)
        # Used to spend comparable time when the account does not exist (user enumeration).
        self._dummy_hash = self._hasher.hash("mailflow-dummy-password")

    def hash(self, password: str) -> str:
        return str(self._hasher.hash(password))

    def verify(self, password_hash: str | None, password: str) -> bool:
        try:
            return bool(self._hasher.verify(password_hash or self._dummy_hash, password)) and (
                password_hash is not None
            )
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False

    def needs_rehash(self, password_hash: str) -> bool:
        return bool(self._hasher.check_needs_rehash(password_hash))
