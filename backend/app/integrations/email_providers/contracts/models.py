"""Normalized data transferred across the provider boundary."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum


class ProviderKind(StrEnum):
    GMAIL = "gmail"
    OUTLOOK = "outlook"
    IMAP = "imap"


class FolderRole(StrEnum):
    INBOX = "inbox"
    STARRED = "starred"
    SENT = "sent"
    DRAFTS = "drafts"
    ARCHIVE = "archive"
    TRASH = "trash"
    SPAM = "spam"
    CUSTOM = "custom"


class ThreadAction(StrEnum):
    MARK_READ = "mark_read"
    MARK_UNREAD = "mark_unread"
    STAR = "star"
    UNSTAR = "unstar"
    ARCHIVE = "archive"
    UNARCHIVE = "unarchive"
    TRASH = "trash"
    RESTORE = "restore"
    SPAM = "spam"
    NOT_SPAM = "not_spam"


class SendMode(StrEnum):
    NEW = "new"
    REPLY = "reply"
    REPLY_ALL = "reply_all"
    FORWARD = "forward"


@dataclass(frozen=True, slots=True)
class ProviderCapabilities:
    """What a provider can really do. Use cases and the UI branch on these flags."""

    threads: bool = False
    labels: bool = False
    server_search: bool = False
    drafts: bool = False
    spam: bool = False
    archive: bool = False
    incremental_sync: bool = False
    oauth: bool = False

    def as_dict(self) -> dict[str, bool]:
        return {
            "threads": self.threads,
            "labels": self.labels,
            "server_search": self.server_search,
            "drafts": self.drafts,
            "spam": self.spam,
            "archive": self.archive,
            "incremental_sync": self.incremental_sync,
        }


@dataclass(frozen=True, slots=True)
class Address:
    email: str
    name: str | None = None


@dataclass(frozen=True, slots=True)
class Credentials:
    """OAuth token set. Lives in memory only for the duration of a call; never logged."""

    access_token: str = field(repr=False)
    refresh_token: str | None = field(default=None, repr=False)
    expires_at: datetime | None = None
    scope: str = ""


class MailSecurity(StrEnum):
    """How a mail server connection is encrypted. There is deliberately no plaintext option."""

    SSL = "ssl"  # implicit TLS (IMAP 993, SMTP 465)
    STARTTLS = "starttls"  # upgrade before authenticating (IMAP 143, SMTP 587)


@dataclass(frozen=True, slots=True)
class MailEndpoint:
    host: str
    port: int
    security: MailSecurity


@dataclass(frozen=True, slots=True)
class ServerCredentials:
    """Password-based mailbox (IMAP + SMTP). Lives in memory only for a call; never logged."""

    imap: MailEndpoint
    smtp: MailEndpoint
    username: str = field(repr=False)
    password: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class Relocation:
    """A message whose provider id changed because an action moved it (IMAP ids are bound to
    a folder). For providers without threads the thread id changes with it."""

    old_message_id: str
    new_message_id: str


@dataclass(frozen=True, slots=True)
class OAuthIdentity:
    subject: str
    email: str


@dataclass(frozen=True, slots=True)
class ProviderAttachment:
    part_id: str
    filename: str
    mime_type: str
    size: int
    content_id: str | None = None
    is_inline: bool = False


@dataclass(frozen=True, slots=True)
class ProviderMessage:
    provider_message_id: str
    provider_thread_id: str
    subject: str
    snippet: str
    sender: Address | None
    to: tuple[Address, ...]
    cc: tuple[Address, ...]
    bcc: tuple[Address, ...]
    reply_to: tuple[Address, ...]
    sent_at: datetime
    is_read: bool
    is_starred: bool
    is_draft: bool
    roles: frozenset[FolderRole]
    folder_ids: tuple[str, ...]
    rfc822_message_id: str | None
    in_reply_to: str | None
    references: str | None
    body_html: str | None = field(default=None, repr=False)
    body_text: str | None = field(default=None, repr=False)
    attachments: tuple[ProviderAttachment, ...] = ()
    size_estimate: int = 0
    provider_draft_id: str | None = None


@dataclass(frozen=True, slots=True)
class ProviderFolder:
    provider_folder_id: str
    name: str
    role: FolderRole


@dataclass(frozen=True, slots=True)
class MessagePage:
    message_ids: tuple[str, ...]
    next_page_token: str | None
    cursor: str | None = None  # sync cursor valid as of this listing, when the provider has one


@dataclass(frozen=True, slots=True)
class SyncChanges:
    """Result of an incremental ``synchronize`` call."""

    upserted_message_ids: tuple[str, ...]
    deleted_message_ids: tuple[str, ...]
    cursor: str


@dataclass(frozen=True, slots=True)
class OutgoingAttachment:
    filename: str
    mime_type: str
    content: bytes = field(repr=False)


@dataclass(frozen=True, slots=True)
class OutgoingMessage:
    sender: Address
    to: tuple[Address, ...]
    cc: tuple[Address, ...]
    bcc: tuple[Address, ...]
    subject: str
    body_html: str = field(repr=False)
    body_text: str = field(repr=False)
    attachments: tuple[OutgoingAttachment, ...] = ()
    provider_thread_id: str | None = None
    in_reply_to: str | None = None
    references: str | None = None


@dataclass(frozen=True, slots=True)
class SentMessage:
    provider_message_id: str
    provider_thread_id: str


@dataclass(frozen=True, slots=True)
class ProviderDraft:
    provider_draft_id: str
    provider_message_id: str
    provider_thread_id: str
