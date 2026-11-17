from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Computed,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database.base import Base, created_at_column, updated_at_column, uuid_pk

_ACCOUNT_FK = ForeignKeyConstraint(
    ["account_id", "user_id"], ["email_accounts.id", "email_accounts.user_id"], ondelete="CASCADE"
)


def _flag(default: bool = False) -> Mapped[bool]:
    return mapped_column(Boolean, nullable=False, default=default, server_default=text("false"))


def _view_index(name: str, column: str) -> Index:
    # One partial index per mailbox view keeps list queries index-only on the hot path.
    return Index(
        f"ix_email_threads_{name}",
        "user_id",
        text("last_message_at DESC"),
        text("id DESC"),
        postgresql_where=text(column),
    )


class EmailThreadModel(Base):
    __tablename__ = "email_threads"
    __table_args__ = (
        ForeignKeyConstraint(
            ["account_id", "user_id"],
            ["email_accounts.id", "email_accounts.user_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("account_id", "provider_thread_id"),
        _view_index("inbox", "in_inbox"),
        _view_index("sent", "in_sent"),
        _view_index("drafts", "in_drafts"),
        _view_index("starred", "is_starred"),
        _view_index("archive", "in_archive"),
        _view_index("trash", "in_trash"),
        _view_index("spam", "in_spam"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    provider_thread_id: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False, default="")
    snippet: Mapped[str] = mapped_column(Text, nullable=False, default="")
    participants: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    has_attachments: Mapped[bool] = _flag()
    is_unread: Mapped[bool] = _flag()
    is_starred: Mapped[bool] = _flag()
    in_inbox: Mapped[bool] = _flag()
    in_sent: Mapped[bool] = _flag()
    in_drafts: Mapped[bool] = _flag()
    in_archive: Mapped[bool] = _flag()
    in_trash: Mapped[bool] = _flag()
    in_spam: Mapped[bool] = _flag()
    last_message_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class EmailMessageModel(Base):
    __tablename__ = "email_messages"
    __table_args__ = (
        ForeignKeyConstraint(
            ["account_id", "user_id"],
            ["email_accounts.id", "email_accounts.user_id"],
            ondelete="CASCADE",
        ),
        # Provider ids are unique only inside one mailbox.
        UniqueConstraint("account_id", "provider_message_id"),
        Index("ix_email_messages_thread", "thread_id", "sent_at"),
        Index("ix_email_messages_user", "user_id"),
        Index("ix_email_messages_search", "search_vector", postgresql_using="gin"),
        Index("ix_email_messages_folders", "folder_ids", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    thread_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("email_threads.id", ondelete="CASCADE"), nullable=False
    )
    provider_message_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_draft_id: Mapped[str | None] = mapped_column(String(255))
    rfc822_message_id: Mapped[str | None] = mapped_column(Text)
    in_reply_to: Mapped[str | None] = mapped_column(Text)
    references_header: Mapped[str | None] = mapped_column(Text)
    from_name: Mapped[str | None] = mapped_column(Text)
    from_email: Mapped[str | None] = mapped_column(String(320))
    to_addresses: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    cc_addresses: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    bcc_addresses: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    reply_to_addresses: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    subject: Mapped[str] = mapped_column(Text, nullable=False, default="")
    snippet: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_read: Mapped[bool] = _flag()
    is_starred: Mapped[bool] = _flag()
    is_draft: Mapped[bool] = _flag()
    in_inbox: Mapped[bool] = _flag()
    in_sent: Mapped[bool] = _flag()
    in_trash: Mapped[bool] = _flag()
    in_spam: Mapped[bool] = _flag()
    folder_ids: Mapped[list[str]] = mapped_column(
        ARRAY(String(255)), nullable=False, default=list, server_default=text("'{}'")
    )
    has_attachments: Mapped[bool] = _flag()
    has_remote_images: Mapped[bool] = _flag()
    size_estimate: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Sanitized HTML only. Raw provider HTML is never persisted.
    body_html: Mapped[str | None] = mapped_column(Text, deferred=True)
    body_text: Mapped[str | None] = mapped_column(Text, deferred=True)
    draft_meta: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    search_vector: Mapped[Any] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(from_name, '') || ' ' "
            "|| coalesce(from_email, '') || ' ' || coalesce(snippet, '') || ' ' "
            "|| left(coalesce(body_text, ''), 100000))",
            persisted=True,
        ),
        deferred=True,
    )
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
