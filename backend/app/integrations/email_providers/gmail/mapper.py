"""Translation between Gmail API payloads / MIME and the provider-neutral models."""

from __future__ import annotations

import base64
import binascii
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import format_datetime, formataddr, getaddresses, make_msgid
from typing import Any

from app.integrations.email_providers.contracts.models import (
    Address,
    FolderRole,
    OutgoingMessage,
    ProviderAttachment,
    ProviderFolder,
    ProviderMessage,
)

SYSTEM_ROLE_LABELS: dict[str, FolderRole] = {
    "INBOX": FolderRole.INBOX,
    "SENT": FolderRole.SENT,
    "DRAFT": FolderRole.DRAFTS,
    "TRASH": FolderRole.TRASH,
    "SPAM": FolderRole.SPAM,
    "STARRED": FolderRole.STARRED,
}
_ROLE_NAMES = {
    FolderRole.INBOX: "Inbox",
    FolderRole.SENT: "Sent",
    FolderRole.DRAFTS: "Drafts",
    FolderRole.TRASH: "Trash",
    FolderRole.SPAM: "Spam",
    FolderRole.STARRED: "Starred",
}
MAX_BODY_BYTES = 2_000_000


def b64url_decode(data: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))
    except (binascii.Error, ValueError):
        return b""


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii")


def parse_addresses(value: str | None) -> tuple[Address, ...]:
    if not value:
        return ()
    result: list[Address] = []
    for name, email in getaddresses([value]):
        email = email.strip().lower()
        if "@" in email and len(email) <= 320:
            result.append(Address(email=email, name=name.strip()[:200] or None))
    return tuple(result)


def _headers(payload: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for header in payload.get("headers") or []:
        name = str(header.get("name", "")).lower()
        if name and name not in result:
            result[name] = str(header.get("value", ""))
    return result


def _decode_text(part: dict[str, Any]) -> str:
    data = (part.get("body") or {}).get("data")
    if not data:
        return ""
    raw = b64url_decode(data)[:MAX_BODY_BYTES]
    charset = "utf-8"
    content_type = _headers(part).get("content-type", "")
    if "charset=" in content_type.lower():
        charset = content_type.lower().split("charset=")[1].split(";")[0].strip(" \"'")
    try:
        return raw.decode(charset, errors="replace")
    except LookupError:
        return raw.decode("utf-8", errors="replace")


def _walk(part: dict[str, Any], acc: dict[str, Any]) -> None:
    mime = str(part.get("mimeType", "")).lower()
    filename = str(part.get("filename") or "")
    body = part.get("body") or {}
    headers = _headers(part)
    disposition = headers.get("content-disposition", "").lower()
    if filename or (body.get("attachmentId") and not mime.startswith("multipart/")):
        content_id = headers.get("content-id", "").strip("<> ") or None
        acc["attachments"].append(
            ProviderAttachment(
                part_id=str(part.get("partId", "")),
                filename=filename,
                mime_type=mime or "application/octet-stream",
                size=int(body.get("size") or 0),
                content_id=content_id,
                is_inline=disposition.startswith("inline") and content_id is not None,
            )
        )
    elif mime == "text/html" and acc["html"] is None:
        acc["html"] = _decode_text(part)
    elif mime == "text/plain" and acc["text"] is None:
        acc["text"] = _decode_text(part)
    for child in part.get("parts") or []:
        _walk(child, acc)


def map_message(data: dict[str, Any], *, draft_id: str | None = None) -> ProviderMessage:
    payload = data.get("payload") or {}
    headers = _headers(payload)
    labels = [str(label) for label in data.get("labelIds") or []]
    acc: dict[str, Any] = {"html": None, "text": None, "attachments": []}
    _walk(payload, acc)
    senders = parse_addresses(headers.get("from"))
    internal_ms = int(data.get("internalDate") or 0)
    roles = frozenset(SYSTEM_ROLE_LABELS[label] for label in labels if label in SYSTEM_ROLE_LABELS)
    return ProviderMessage(
        provider_message_id=str(data["id"]),
        provider_thread_id=str(data.get("threadId") or data["id"]),
        subject=headers.get("subject", "")[:998],
        snippet=str(data.get("snippet", "")),
        sender=senders[0] if senders else None,
        to=parse_addresses(headers.get("to")),
        cc=parse_addresses(headers.get("cc")),
        bcc=parse_addresses(headers.get("bcc")),
        reply_to=parse_addresses(headers.get("reply-to")),
        sent_at=datetime.fromtimestamp(internal_ms / 1000, tz=UTC),
        is_read="UNREAD" not in labels,
        is_starred="STARRED" in labels,
        is_draft="DRAFT" in labels,
        roles=roles,
        folder_ids=tuple(label for label in labels if is_user_label(label)),
        rfc822_message_id=headers.get("message-id") or None,
        in_reply_to=headers.get("in-reply-to") or None,
        references=headers.get("references") or None,
        body_html=acc["html"],
        body_text=acc["text"],
        attachments=tuple(acc["attachments"]),
        size_estimate=int(data.get("sizeEstimate") or 0),
        provider_draft_id=draft_id,
    )


def is_user_label(label_id: str) -> bool:
    return label_id.startswith("Label_")


def map_labels(labels: list[dict[str, Any]]) -> list[ProviderFolder]:
    folders: list[ProviderFolder] = []
    for label in labels:
        label_id = str(label.get("id", ""))
        if label_id in SYSTEM_ROLE_LABELS:
            role = SYSTEM_ROLE_LABELS[label_id]
            folders.append(ProviderFolder(label_id, _ROLE_NAMES[role], role))
        elif label.get("type") == "user" and label_id:
            folders.append(
                ProviderFolder(label_id, str(label.get("name", label_id))[:255], FolderRole.CUSTOM)
            )
    return folders


def find_attachment_id(payload: dict[str, Any], part_id: str) -> str | None:
    """Gmail attachment ids are not stable between fetches; the part id is."""
    if str(payload.get("partId", "")) == part_id:
        attachment_id = (payload.get("body") or {}).get("attachmentId")
        return str(attachment_id) if attachment_id else None
    for child in payload.get("parts") or []:
        found = find_attachment_id(child, part_id)
        if found:
            return found
    return None


def find_inline_data(payload: dict[str, Any], part_id: str) -> bytes | None:
    if str(payload.get("partId", "")) == part_id:
        data = (payload.get("body") or {}).get("data")
        return b64url_decode(data) if data else None
    for child in payload.get("parts") or []:
        found = find_inline_data(child, part_id)
        if found is not None:
            return found
    return None


def _format(addresses: tuple[Address, ...]) -> str:
    return ", ".join(formataddr((a.name or "", a.email)) for a in addresses)


def build_mime(message: OutgoingMessage) -> bytes:
    """Build an RFC 5322 message. Header values go through ``email`` so they cannot inject."""
    mime = EmailMessage()
    mime["From"] = formataddr((message.sender.name or "", message.sender.email))
    if message.to:
        mime["To"] = _format(message.to)
    if message.cc:
        mime["Cc"] = _format(message.cc)
    if message.bcc:
        mime["Bcc"] = _format(message.bcc)
    mime["Subject"] = message.subject.replace("\r", " ").replace("\n", " ")
    mime["Date"] = format_datetime(datetime.now(UTC))
    mime["Message-ID"] = make_msgid(domain=message.sender.email.rsplit("@", 1)[-1])
    if message.in_reply_to:
        mime["In-Reply-To"] = message.in_reply_to.replace("\r", "").replace("\n", "")
    if message.references:
        mime["References"] = " ".join(message.references.split())
    mime.set_content(message.body_text or " ")
    mime.add_alternative(message.body_html, subtype="html")
    for attachment in message.attachments:
        maintype, _, subtype = attachment.mime_type.partition("/")
        mime.add_attachment(
            attachment.content,
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=attachment.filename,
        )
    return mime.as_bytes()
