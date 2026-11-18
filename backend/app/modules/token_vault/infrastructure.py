"""AES-256-GCM keyring and credential persistence."""

from __future__ import annotations

import base64
import binascii
import os
import uuid
from datetime import datetime

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import (
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    LargeBinary,
    String,
    UniqueConstraint,
    delete,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import UUID, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database.base import Base, updated_at_column, uuid_pk
from app.modules.token_vault.domain import (
    CredentialKind,
    SealedSecret,
    UserSecretKind,
    VaultError,
)

NONCE_BYTES = 12
KEY_BYTES = 32


class AesGcmKeyring:
    """Versioned keyring: encrypts with the primary key, decrypts with any known key."""

    def __init__(self, keys: dict[str, bytes], primary_key_id: str) -> None:
        if primary_key_id not in keys:
            raise VaultError("Primary vault key is not present in the keyring.")
        for key_id, key in keys.items():
            if len(key) != KEY_BYTES:
                raise VaultError(f"Vault key '{key_id}' must be {KEY_BYTES} bytes.")
        self._keys = {key_id: AESGCM(key) for key_id, key in keys.items()}
        self._primary = primary_key_id

    @classmethod
    def from_config(cls, raw_keys: str, primary_key_id: str) -> AesGcmKeyring:
        keys: dict[str, bytes] = {}
        for item in filter(None, (part.strip() for part in raw_keys.split(","))):
            key_id, _, encoded = item.partition(":")
            try:
                keys[key_id] = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise VaultError(f"Vault key '{key_id}' is not valid base64.") from exc
        if not keys:
            raise VaultError("No vault keys configured (VAULT_KEYS).")
        return cls(keys, primary_key_id or next(iter(keys)))

    @property
    def primary_key_id(self) -> str:
        return self._primary

    def seal(self, plaintext: bytes, *, aad: bytes) -> SealedSecret:
        nonce = os.urandom(NONCE_BYTES)
        ciphertext = self._keys[self._primary].encrypt(nonce, plaintext, aad)
        return SealedSecret(key_id=self._primary, nonce=nonce, ciphertext=ciphertext)

    def open(self, sealed: SealedSecret, *, aad: bytes) -> bytes:
        cipher = self._keys.get(sealed.key_id)
        if cipher is None:
            raise VaultError("Credential was encrypted with an unknown key.")
        try:
            return cipher.decrypt(sealed.nonce, sealed.ciphertext, aad)
        except InvalidTag as exc:
            raise VaultError("Credential failed authentication.") from exc


class AccountCredentialModel(Base):
    __tablename__ = "account_credentials"
    __table_args__ = (
        ForeignKeyConstraint(
            ["account_id", "user_id"],
            ["email_accounts.id", "email_accounts.user_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("account_id", "kind"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    key_id: Mapped[str] = mapped_column(String(64), nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = updated_at_column()


class SqlCredentialRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def upsert(
        self,
        *,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        kind: CredentialKind,
        sealed: SealedSecret,
        expires_at: datetime | None,
    ) -> None:
        values = {
            "key_id": sealed.key_id,
            "nonce": sealed.nonce,
            "ciphertext": sealed.ciphertext,
            "expires_at": expires_at,
        }
        stmt = insert(AccountCredentialModel).values(
            id=uuid.uuid4(), user_id=user_id, account_id=account_id, kind=kind.value, **values
        )
        await self._db.execute(
            stmt.on_conflict_do_update(
                index_elements=["account_id", "kind"],
                set_=values,
                where=AccountCredentialModel.user_id == user_id,
            )
        )

    async def get(
        self, user_id: uuid.UUID, account_id: uuid.UUID, kind: CredentialKind
    ) -> tuple[SealedSecret, datetime | None] | None:
        row = await self._db.scalar(
            select(AccountCredentialModel)
            .where(
                AccountCredentialModel.user_id == user_id,
                AccountCredentialModel.account_id == account_id,
                AccountCredentialModel.kind == kind.value,
            )
            .execution_options(populate_existing=True)
        )
        if row is None:
            return None
        return SealedSecret(row.key_id, row.nonce, row.ciphertext), row.expires_at

    async def delete_for_account(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        await self._db.execute(
            delete(AccountCredentialModel).where(
                AccountCredentialModel.user_id == user_id,
                AccountCredentialModel.account_id == account_id,
            )
        )

    async def list_stale(
        self, user_id: uuid.UUID, primary_key_id: str
    ) -> list[tuple[uuid.UUID, CredentialKind, SealedSecret, datetime | None]]:
        rows = await self._db.scalars(
            select(AccountCredentialModel).where(
                AccountCredentialModel.user_id == user_id,
                AccountCredentialModel.key_id != primary_key_id,
            )
        )
        return [
            (
                r.account_id,
                CredentialKind(r.kind),
                SealedSecret(r.key_id, r.nonce, r.ciphertext),
                r.expires_at,
            )
            for r in rows
        ]


class UserSecretModel(Base):
    __tablename__ = "user_secrets"
    __table_args__ = (UniqueConstraint("user_id", "kind"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    key_id: Mapped[str] = mapped_column(String(64), nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    updated_at: Mapped[datetime] = updated_at_column()


class SqlUserSecretRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def upsert(
        self, *, user_id: uuid.UUID, kind: UserSecretKind, sealed: SealedSecret
    ) -> None:
        values = {"key_id": sealed.key_id, "nonce": sealed.nonce, "ciphertext": sealed.ciphertext}
        stmt = insert(UserSecretModel).values(
            id=uuid.uuid4(), user_id=user_id, kind=kind.value, **values
        )
        await self._db.execute(
            stmt.on_conflict_do_update(
                index_elements=["user_id", "kind"],
                set_={**values, "updated_at": func.now()},
                where=UserSecretModel.user_id == user_id,
            )
        )

    async def get(self, user_id: uuid.UUID, kind: UserSecretKind) -> SealedSecret | None:
        row = await self._db.scalar(
            select(UserSecretModel)
            .where(UserSecretModel.user_id == user_id, UserSecretModel.kind == kind.value)
            .execution_options(populate_existing=True)
        )
        return SealedSecret(row.key_id, row.nonce, row.ciphertext) if row else None

    async def delete(self, user_id: uuid.UUID, kind: UserSecretKind) -> None:
        await self._db.execute(
            delete(UserSecretModel).where(
                UserSecretModel.user_id == user_id, UserSecretModel.kind == kind.value
            )
        )

    async def list_stale(
        self, user_id: uuid.UUID, primary_key_id: str
    ) -> list[tuple[UserSecretKind, SealedSecret]]:
        rows = await self._db.scalars(
            select(UserSecretModel).where(
                UserSecretModel.user_id == user_id, UserSecretModel.key_id != primary_key_id
            )
        )
        return [
            (UserSecretKind(r.kind), SealedSecret(r.key_id, r.nonce, r.ciphertext)) for r in rows
        ]
