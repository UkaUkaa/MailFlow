"""Token Vault domain types."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class CredentialKind(StrEnum):
    OAUTH_TOKENS = "oauth_tokens"
    IMAP_PASSWORD = "imap_password"
    SMTP_PASSWORD = "smtp_password"


class UserSecretKind(StrEnum):
    """Secrets that belong to the user rather than to one connected mailbox."""

    AI_API_KEY = "ai_api_key"


@dataclass(frozen=True, slots=True)
class SealedSecret:
    """Authenticated ciphertext plus the identifier of the key that produced it."""

    key_id: str
    nonce: bytes
    ciphertext: bytes


class VaultError(Exception):
    """Decryption failed or the vault is misconfigured. Never includes secret material."""
