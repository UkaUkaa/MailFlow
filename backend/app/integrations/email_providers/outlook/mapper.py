"""Translation between Microsoft Graph mail payloads and the provider-neutral models.

Nothing Graph-shaped leaves this package: callers get ``ProviderMessage`` / ``ProviderFolder``
and hand in ``OutgoingMessage``.
"""

from __future__ import annotations

import base64
import hashlib
from datetime import UTC, datetime
from typing import Any

from app.integrations.email_providers.contracts.models import (
    Address,
    FolderRole,
    OutgoingAttachment,
    OutgoingMessage,
    ProviderAttachment,
    ProviderFolder,
    ProviderMessage,
)

# Well-known folder names (mailFolder resource, checked 2026-11-17). They work regardless of
# the mailbox language and are accepted wherever a folder id is.
# https://learn.microsoft.com/en-us/graph/api/resources/mailfolder
WELL_KNOWN_FOLDERS: dict[str, FolderRole] = {
    "inbox": FolderRole.INBOX,
    "sentitems": FolderRole.SENT,
    "drafts": FolderRole.DRAFTS,
    "deleteditems": FolderRole.TRASH,
    "junkemail": FolderRole.SPAM,
    "archive": FolderRole.ARCHIVE,
}
WELL_KNOWN_BY_ROLE: dict[FolderRole, str] = {
    role: name for name, role in WELL_KNOWN_FOLDERS.items()
}
_ROLE_NAMES = {
    FolderRole.INBOX: "Inbox",
    FolderRole.SENT: "Sent",
    FolderRole.DRAFTS: "Drafts",
    FolderRole.TRASH: "Trash",
    FolderRole.SPAM: "Spam",
    FolderRole.ARCHIVE: "Archive",
}
_ROLE_ORDER = list(_ROLE_NAMES)

MESSAGE_FIELDS = (
    "id,conversationId,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,"
    "bccRecipients,replyTo,receivedDateTime,sentDateTime,createdDateTime,isRead,isDraft,flag,"
    "parentFolderId,internetMessageId,internetMessageHeaders,hasAttachments"
)
# ``contentBytes`` is deliberately not selected: metadata only.
ATTACHMENT_FIELDS = "id,name,contentType,size,isInline"
MAX_BODY_CHARS = 2_000_000
EPOCH = datetime.fromtimestamp(0, tz=UTC)


def attachment_part_id(attachment_id: str) -> str:
    """Stable 64-character handle for a Graph attachment id.

    Graph attachment ids are far longer than the 64 characters MailFlow stores for a part id,
    so the stored handle is a digest and the real id is looked up again at download time.
    """
    return hashlib.sha256(attachment_id.encode()).hexdigest()


def parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _address(entry: object) -> Address | None:
    if not isinstance(entry, dict):
        return None
    inner = entry.get("emailAddress")
    if not isinstance(inner, dict):
        return None
    email = str(inner.get("address") or "").strip().lower()
    if "@" not in email or len(email) > 320:
        return None
    name = str(inner.get("name") or "").strip()[:200]
    return Address(email=email, name=name if name and name.lower() != email else None)


def _addresses(entries: object) -> tuple[Address, ...]:
    if not isinstance(entries, list):
        return ()
    return tuple(a for a in (_address(e) for e in entries) if a is not None)


def _header(data: dict[str, Any], name: str) -> str | None:
    for header in data.get("internetMessageHeaders") or []:
        if isinstance(header, dict) and str(header.get("name", "")).lower() == name:
            return str(header.get("value") or "") or None
    return None


def needs_attachment_lookup(data: dict[str, Any]) -> bool:
    """``hasAttachments`` is false for messages that only carry inline images, so a body
    that references ``cid:`` content is checked as well."""
    if data.get("hasAttachments"):
        return True
    body = data.get("body")
    return isinstance(body, dict) and "cid:" in str(body.get("content") or "")


def map_attachment(data: dict[str, Any]) -> ProviderAttachment | None:
    attachment_id = str(data.get("id") or "")
    if not attachment_id:
        return None
    content_id = str(data.get("contentId") or "").strip("<> ") or None
    return ProviderAttachment(
        part_id=attachment_part_id(attachment_id),
        filename=str(data.get("name") or "")[:255],
        mime_type=str(data.get("contentType") or "application/octet-stream").lower()[:255],
        size=int(data.get("size") or 0),
        content_id=content_id,
        is_inline=bool(data.get("isInline")),
    )


def map_message(
    data: dict[str, Any],
    *,
    folder_roles: dict[str, FolderRole],
    attachments: list[dict[str, Any]] | None = None,
) -> ProviderMessage:
    """``folder_roles`` maps the ids of the mailbox's well-known folders to their role."""
    message_id = str(data["id"])
    parent = str(data.get("parentFolderId") or "")
    role = folder_roles.get(parent)
    flag = data.get("flag")
    starred = isinstance(flag, dict) and flag.get("flagStatus") == "flagged"
    roles = {role} if role is not None else set()
    if starred:
        roles.add(FolderRole.STARRED)
    raw_body = data.get("body")
    body: dict[str, Any] = raw_body if isinstance(raw_body, dict) else {}
    content = str(body.get("content") or "")[:MAX_BODY_CHARS]
    is_html = str(body.get("contentType") or "").lower() == "html"
    is_draft = bool(data.get("isDraft"))
    sent_at = (
        parse_datetime(data.get("receivedDateTime"))
        or parse_datetime(data.get("sentDateTime"))
        or parse_datetime(data.get("createdDateTime"))
        or EPOCH
    )
    return ProviderMessage(
        provider_message_id=message_id,
        provider_thread_id=str(data.get("conversationId") or message_id),
        subject=str(data.get("subject") or "")[:998],
        snippet=str(data.get("bodyPreview") or ""),
        sender=_address(data.get("from")) or _address(data.get("sender")),
        to=_addresses(data.get("toRecipients")),
        cc=_addresses(data.get("ccRecipients")),
        bcc=_addresses(data.get("bccRecipients")),
        reply_to=_addresses(data.get("replyTo")),
        sent_at=sent_at,
        is_read=bool(data.get("isRead")),
        is_starred=starred,
        is_draft=is_draft,
        roles=frozenset(roles),
        # A message lives in exactly one folder; only non-system folders are listed here,
        # the system ones are expressed as roles.
        folder_ids=(parent,) if parent and role is None else (),
        rfc822_message_id=str(data.get("internetMessageId") or "") or None,
        in_reply_to=_header(data, "in-reply-to"),
        references=_header(data, "references"),
        body_html=content if is_html and content else None,
        body_text=content if not is_html and content else None,
        attachments=tuple(
            a for a in (map_attachment(item) for item in attachments or []) if a is not None
        ),
        size_estimate=0,  # Graph v1.0 exposes no message size
        provider_draft_id=message_id if is_draft else None,  # a draft is just a message
    )


def map_folders(
    folders: list[dict[str, Any]], folder_roles: dict[str, FolderRole]
) -> list[ProviderFolder]:
    """System folders first (named by role), then every other folder by its path."""
    by_id = {str(f.get("id") or ""): f for f in folders}

    def path(folder: dict[str, Any]) -> str:
        parts: list[str] = []
        current: dict[str, Any] | None = folder
        for _ in range(10):
            if current is None:
                break
            parts.append(str(current.get("displayName") or "").replace("/", "-"))
            current = by_id.get(str(current.get("parentFolderId") or ""))
        return "/".join(reversed(parts))[:255]

    system: list[ProviderFolder] = []
    custom: list[ProviderFolder] = []
    for folder_id, folder in by_id.items():
        if not folder_id:
            continue
        role = folder_roles.get(folder_id)
        if role is not None:
            system.append(ProviderFolder(folder_id, _ROLE_NAMES[role], role))
        else:
            custom.append(ProviderFolder(folder_id, path(folder) or folder_id, FolderRole.CUSTOM))
    system.sort(key=lambda f: _ROLE_ORDER.index(f.role))
    return system + custom


def _recipient(address: Address) -> dict[str, Any]:
    entry: dict[str, str] = {"address": address.email}
    if address.name:
        entry["name"] = address.name
    return {"emailAddress": entry}


def build_message(message: OutgoingMessage) -> dict[str, Any]:
    """JSON body for creating or updating a draft. Values travel as JSON strings, so header
    injection through the subject or an address is not possible. ``from`` is left to the
    mailbox, which is the only sender the grant allows."""
    return {
        "subject": message.subject.replace("\r", " ").replace("\n", " "),
        "body": {"contentType": "html", "content": message.body_html},
        "toRecipients": [_recipient(a) for a in message.to],
        "ccRecipients": [_recipient(a) for a in message.cc],
        "bccRecipients": [_recipient(a) for a in message.bcc],
    }


def build_file_attachment(attachment: OutgoingAttachment) -> dict[str, Any]:
    return {
        "@odata.type": "#microsoft.graph.fileAttachment",
        "name": attachment.filename,
        "contentType": attachment.mime_type,
        "contentBytes": base64.b64encode(attachment.content).decode("ascii"),
    }


def build_upload_session(attachment: OutgoingAttachment) -> dict[str, Any]:
    return {
        "AttachmentItem": {
            "attachmentType": "file",
            "name": attachment.filename,
            "size": len(attachment.content),
            "contentType": attachment.mime_type,
        }
    }
