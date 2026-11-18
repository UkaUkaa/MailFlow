"""Token Vault use cases. The only component that sees provider credentials in plaintext."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Protocol

from app.modules.token_vault.domain import CredentialKind, SealedSecret, UserSecretKind


class Cipher(Protocol):
    @property
    def primary_key_id(self) -> str: ...
    def seal(self, plaintext: bytes, *, aad: bytes) -> SealedSecret: ...
    def open(self, sealed: SealedSecret, *, aad: bytes) -> bytes: ...


class CredentialRepository(Protocol):
    async def upsert(
        self,
        *,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        kind: CredentialKind,
        sealed: SealedSecret,
        expires_at: datetime | None,
    ) -> None: ...
    async def get(
        self, user_id: uuid.UUID, account_id: uuid.UUID, kind: CredentialKind
    ) -> tuple[SealedSecret, datetime | None] | None: ...
    async def delete_for_account(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None: ...
    async def list_stale(
        self, user_id: uuid.UUID, primary_key_id: str
    ) -> list[tuple[uuid.UUID, CredentialKind, SealedSecret, datetime | None]]: ...


def _aad(user_id: uuid.UUID, account_id: uuid.UUID, kind: CredentialKind) -> bytes:
    # Binds a ciphertext to its owner, account and purpose: moving a row to another
    # account or tenant makes decryption fail.
    return f"mailflow:v1|{user_id}|{account_id}|{kind.value}".encode()


class TokenVault:
    def __init__(self, cipher: Cipher, repository: CredentialRepository) -> None:
        self._cipher = cipher
        self._repo = repository

    async def store(
        self,
        *,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        kind: CredentialKind,
        secret: dict[str, Any],
        expires_at: datetime | None = None,
    ) -> None:
        plaintext = json.dumps(secret, separators=(",", ":")).encode()
        sealed = self._cipher.seal(plaintext, aad=_aad(user_id, account_id, kind))
        await self._repo.upsert(
            user_id=user_id, account_id=account_id, kind=kind, sealed=sealed, expires_at=expires_at
        )

    async def read(
        self, *, user_id: uuid.UUID, account_id: uuid.UUID, kind: CredentialKind
    ) -> tuple[dict[str, Any], datetime | None] | None:
        found = await self._repo.get(user_id, account_id, kind)
        if found is None:
            return None
        sealed, expires_at = found
        plaintext = self._cipher.open(sealed, aad=_aad(user_id, account_id, kind))
        return json.loads(plaintext), expires_at

    async def delete(self, *, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        await self._repo.delete_for_account(user_id, account_id)

    async def rotate_user(self, user_id: uuid.UUID) -> int:
        """Re-encrypt the user's credentials that are not under the primary key."""
        rotated = 0
        for account_id, kind, sealed, expires_at in await self._repo.list_stale(
            user_id, self._cipher.primary_key_id
        ):
            aad = _aad(user_id, account_id, kind)
            fresh = self._cipher.seal(self._cipher.open(sealed, aad=aad), aad=aad)
            await self._repo.upsert(
                user_id=user_id,
                account_id=account_id,
                kind=kind,
                sealed=fresh,
                expires_at=expires_at,
            )
            rotated += 1
        return rotated


class UserSecretRepository(Protocol):
    async def upsert(
        self, *, user_id: uuid.UUID, kind: UserSecretKind, sealed: SealedSecret
    ) -> None: ...
    async def get(self, user_id: uuid.UUID, kind: UserSecretKind) -> SealedSecret | None: ...
    async def delete(self, user_id: uuid.UUID, kind: UserSecretKind) -> None: ...
    async def list_stale(
        self, user_id: uuid.UUID, primary_key_id: str
    ) -> list[tuple[UserSecretKind, SealedSecret]]: ...


def _user_aad(user_id: uuid.UUID, kind: UserSecretKind) -> bytes:
    return f"mailflow:v1|{user_id}|user|{kind.value}".encode()


class UserSecretVault:
    """User-level secrets (e.g. the user's own AI API key), same keyring and guarantees as
    mailbox credentials: AES-256-GCM, bound to owner and purpose, never returned or logged."""

    def __init__(self, cipher: Cipher, repository: UserSecretRepository) -> None:
        self._cipher = cipher
        self._repo = repository

    async def store(self, *, user_id: uuid.UUID, kind: UserSecretKind, secret: str) -> None:
        sealed = self._cipher.seal(secret.encode(), aad=_user_aad(user_id, kind))
        await self._repo.upsert(user_id=user_id, kind=kind, sealed=sealed)

    async def read(self, *, user_id: uuid.UUID, kind: UserSecretKind) -> str | None:
        sealed = await self._repo.get(user_id, kind)
        if sealed is None:
            return None
        return self._cipher.open(sealed, aad=_user_aad(user_id, kind)).decode()

    async def delete(self, *, user_id: uuid.UUID, kind: UserSecretKind) -> None:
        await self._repo.delete(user_id, kind)

    async def rotate_user(self, user_id: uuid.UUID) -> int:
        rotated = 0
        for kind, sealed in await self._repo.list_stale(user_id, self._cipher.primary_key_id):
            aad = _user_aad(user_id, kind)
            fresh = self._cipher.seal(self._cipher.open(sealed, aad=aad), aad=aad)
            await self._repo.upsert(user_id=user_id, kind=kind, sealed=fresh)
            rotated += 1
        return rotated
