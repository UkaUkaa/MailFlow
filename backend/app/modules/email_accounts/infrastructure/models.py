from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, LargeBinary, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database.base import Base, created_at_column, updated_at_column, uuid_pk


class EmailAccountModel(Base):
    __tablename__ = "email_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "email_address"),
        # Target of composite foreign keys that pin child rows to the same tenant.
        UniqueConstraint("id", "user_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    email_address: Mapped[str] = mapped_column(String(320), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str] = mapped_column(String(16), nullable=False, default="blue")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    status_reason: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class OAuthStateModel(Base):
    __tablename__ = "oauth_states"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    state_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    verifier_key_id: Mapped[str] = mapped_column(String(64), nullable=False)
    verifier_nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    verifier_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    reconnect_account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="en")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_column()
