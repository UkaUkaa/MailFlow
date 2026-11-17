"""Message and thread model plus the pure rules that derive thread state."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime

from app.integrations.email_providers.contracts import Address, FolderRole, ThreadAction

MAX_PARTICIPANTS = 6


@dataclass(frozen=True, slots=True)
class MessageFlags:
    is_read: bool
    is_starred: bool
    is_draft: bool
    in_inbox: bool
    in_sent: bool
    in_trash: bool
    in_spam: bool

    @staticmethod
    def from_roles(
        roles: frozenset[FolderRole], *, is_read: bool, is_starred: bool, is_draft: bool
    ) -> MessageFlags:
        return MessageFlags(
            is_read=is_read,
            is_starred=is_starred,
            is_draft=is_draft,
            in_inbox=FolderRole.INBOX in roles,
            in_sent=FolderRole.SENT in roles,
            in_trash=FolderRole.TRASH in roles,
            in_spam=FolderRole.SPAM in roles,
        )


def apply_action(flags: MessageFlags, action: ThreadAction) -> MessageFlags:
    """Local mirror of what the provider does, applied after the provider call succeeds."""
    match action:
        case ThreadAction.MARK_READ:
            return replace(flags, is_read=True)
        case ThreadAction.MARK_UNREAD:
            return replace(flags, is_read=False)
        case ThreadAction.STAR:
            return replace(flags, is_starred=True)
        case ThreadAction.UNSTAR:
            return replace(flags, is_starred=False)
        case ThreadAction.ARCHIVE:
            return replace(flags, in_inbox=False)
        case ThreadAction.UNARCHIVE:
            return replace(flags, in_inbox=True)
        case ThreadAction.TRASH:
            return replace(flags, in_trash=True, in_inbox=False, in_spam=False)
        case ThreadAction.RESTORE:
            return replace(flags, in_trash=False, in_inbox=True)
        case ThreadAction.SPAM:
            return replace(flags, in_spam=True, in_inbox=False)
        case ThreadAction.NOT_SPAM:
            return replace(flags, in_spam=False, in_inbox=True)


@dataclass(frozen=True, slots=True)
class MessageState:
    """The slice of a message needed to derive its thread's summary."""

    flags: MessageFlags
    sent_at: datetime
    subject: str
    snippet: str
    sender: Address | None
    has_attachments: bool


@dataclass(frozen=True, slots=True)
class ThreadState:
    subject: str
    snippet: str
    participants: tuple[Address, ...]
    message_count: int
    has_attachments: bool
    is_unread: bool
    is_starred: bool
    last_message_at: datetime
    in_inbox: bool
    in_sent: bool
    in_drafts: bool
    in_archive: bool
    in_trash: bool
    in_spam: bool


def compute_thread_state(messages: list[MessageState]) -> ThreadState | None:
    """Derive the thread summary. Trashed and spam messages only count when nothing else is left."""
    if not messages:
        return None
    ordered = sorted(messages, key=lambda m: m.sent_at)
    live = [m for m in ordered if not m.flags.in_trash and not m.flags.in_spam]
    basis = live or ordered
    participants: dict[str, Address] = {}
    for message in basis:
        if message.sender is not None:
            participants.setdefault(message.sender.email, message.sender)
    in_inbox = any(m.flags.in_inbox for m in live)
    received = [m for m in live if not m.flags.is_draft and not m.flags.in_sent]
    return ThreadState(
        subject=basis[0].subject,
        snippet=basis[-1].snippet,
        participants=tuple(participants.values())[:MAX_PARTICIPANTS],
        message_count=len(basis),
        has_attachments=any(m.has_attachments for m in basis),
        is_unread=any(not m.flags.is_read for m in basis),
        is_starred=any(m.flags.is_starred for m in live),
        last_message_at=basis[-1].sent_at,
        in_inbox=in_inbox,
        in_sent=any(m.flags.in_sent for m in live),
        in_drafts=any(m.flags.is_draft for m in live),
        in_archive=bool(received) and not in_inbox,
        in_trash=any(m.flags.in_trash for m in ordered),
        in_spam=any(m.flags.in_spam for m in ordered),
    )


@dataclass(frozen=True, slots=True)
class ThreadSummary:
    id: uuid.UUID
    account_id: uuid.UUID
    provider_thread_id: str
    subject: str
    snippet: str
    participants: tuple[Address, ...]
    message_count: int
    has_attachments: bool
    is_unread: bool
    is_starred: bool
    last_message_at: datetime


@dataclass(frozen=True, slots=True)
class DraftMeta:
    mode: str = "new"
    source_message_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class Message:
    id: uuid.UUID
    thread_id: uuid.UUID
    account_id: uuid.UUID
    provider_message_id: str
    provider_draft_id: str | None
    sender: Address | None
    to: tuple[Address, ...]
    cc: tuple[Address, ...]
    bcc: tuple[Address, ...]
    reply_to: tuple[Address, ...]
    subject: str
    snippet: str
    sent_at: datetime
    flags: MessageFlags
    rfc822_message_id: str | None
    references: str | None
    has_remote_images: bool
    body_html: str | None = field(default=None, repr=False)
    body_text: str | None = field(default=None, repr=False)
    draft_meta: DraftMeta | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class StoredMessage:
    """A provider message after normalization and sanitization, ready to persist."""

    provider_message_id: str
    provider_draft_id: str | None
    sender: Address | None
    to: tuple[Address, ...]
    cc: tuple[Address, ...]
    bcc: tuple[Address, ...]
    reply_to: tuple[Address, ...]
    subject: str
    snippet: str
    sent_at: datetime
    flags: MessageFlags
    folder_ids: tuple[str, ...]
    rfc822_message_id: str | None
    in_reply_to: str | None
    references: str | None
    has_attachments: bool
    size_estimate: int
    body_html: str | None = field(repr=False)
    body_text: str | None = field(repr=False)
    has_remote_images: bool


VIEW_ROLES = (
    FolderRole.INBOX,
    FolderRole.STARRED,
    FolderRole.SENT,
    FolderRole.DRAFTS,
    FolderRole.ARCHIVE,
    FolderRole.TRASH,
    FolderRole.SPAM,
)
