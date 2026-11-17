"""Response/request schemas shared by the mail routers. ORM models are never exposed."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.integrations.email_providers.contracts import Address
from app.modules.attachments.application import Attachment
from app.modules.emails.application.queries import MessageView
from app.modules.emails.domain.entities import Message, ThreadSummary


class AddressModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, max_length=200)
    email: EmailStr

    def to_domain(self) -> Address:
        return Address(email=str(self.email).lower(), name=(self.name or "").strip() or None)


class AddressOut(BaseModel):
    name: str | None
    email: str


def addresses_out(values: tuple[Address, ...]) -> list[AddressOut]:
    return [AddressOut(name=a.name, email=a.email) for a in values]


class AttachmentOut(BaseModel):
    id: uuid.UUID
    filename: str
    mime_type: str
    size: int
    is_inline: bool


class ThreadSummaryOut(BaseModel):
    id: uuid.UUID
    account_id: uuid.UUID
    subject: str
    snippet: str
    participants: list[AddressOut]
    message_count: int
    has_attachments: bool
    is_unread: bool
    is_starred: bool
    last_message_at: datetime


class ThreadListOut(BaseModel):
    items: list[ThreadSummaryOut]
    next_cursor: str | None


class MessageOut(BaseModel):
    id: uuid.UUID
    thread_id: uuid.UUID
    account_id: uuid.UUID
    from_: AddressOut | None = Field(serialization_alias="from")
    to: list[AddressOut]
    cc: list[AddressOut]
    bcc: list[AddressOut]
    reply_to: list[AddressOut]
    subject: str
    snippet: str
    sent_at: datetime
    is_read: bool
    is_starred: bool
    is_draft: bool
    body_html: str | None
    body_text: str | None
    has_remote_images: bool
    attachments: list[AttachmentOut]


class ThreadDetailOut(ThreadSummaryOut):
    messages: list[MessageOut]


class DraftOut(BaseModel):
    id: uuid.UUID
    account_id: uuid.UUID
    thread_id: uuid.UUID
    to: list[AddressOut]
    cc: list[AddressOut]
    bcc: list[AddressOut]
    subject: str
    body_html: str
    mode: Literal["new", "reply", "reply_all", "forward"]
    source_message_id: uuid.UUID | None
    updated_at: datetime


def thread_out(t: ThreadSummary) -> ThreadSummaryOut:
    return ThreadSummaryOut(
        id=t.id,
        account_id=t.account_id,
        subject=t.subject,
        snippet=t.snippet,
        participants=addresses_out(t.participants),
        message_count=t.message_count,
        has_attachments=t.has_attachments,
        is_unread=t.is_unread,
        is_starred=t.is_starred,
        last_message_at=t.last_message_at,
    )


def attachment_out(a: Attachment) -> AttachmentOut:
    return AttachmentOut(
        id=a.id, filename=a.filename, mime_type=a.mime_type, size=a.size, is_inline=a.is_inline
    )


def message_out(view: MessageView) -> MessageOut:
    m = view.message
    return MessageOut(
        id=m.id,
        thread_id=m.thread_id,
        account_id=m.account_id,
        from_=AddressOut(name=m.sender.name, email=m.sender.email) if m.sender else None,
        to=addresses_out(m.to),
        cc=addresses_out(m.cc),
        bcc=addresses_out(m.bcc),
        reply_to=addresses_out(m.reply_to),
        subject=m.subject,
        snippet=m.snippet,
        sent_at=m.sent_at,
        is_read=m.flags.is_read,
        is_starred=m.flags.is_starred,
        is_draft=m.flags.is_draft,
        body_html=m.body_html,
        body_text=m.body_text,
        has_remote_images=m.has_remote_images,
        attachments=[attachment_out(a) for a in view.attachments],
    )


def draft_out(m: Message) -> DraftOut:
    meta = m.draft_meta
    mode = meta.mode if meta and meta.mode in ("new", "reply", "reply_all", "forward") else "new"
    return DraftOut(
        id=m.id,
        account_id=m.account_id,
        thread_id=m.thread_id,
        to=addresses_out(m.to),
        cc=addresses_out(m.cc),
        bcc=addresses_out(m.bcc),
        subject=m.subject,
        body_html=m.body_html or "",
        mode=mode,
        source_message_id=meta.source_message_id if meta else None,
        updated_at=m.updated_at or m.sent_at,
    )
