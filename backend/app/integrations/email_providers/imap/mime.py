"""RFC 5322 / MIME <-> provider-neutral models. Pure functions, no I/O.

Bodies are returned as they arrived: sanitizing is the ingestion pipeline's job, for every
provider alike. Parsing never raises on malformed mail — a broken message yields whatever
could be recovered.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email import message_from_bytes, policy
from email.message import EmailMessage, Message
from email.utils import format_datetime, formataddr, getaddresses, make_msgid, parsedate_to_datetime

from app.integrations.email_providers.contracts.errors import ProviderError
from app.integrations.email_providers.contracts.models import (
    Address,
    OutgoingMessage,
    ProviderAttachment,
)

MAX_BODY_BYTES = 2_000_000
MAX_PARTS = 500
MAX_ADDRESSES = 500
SNIPPET_CHARS = 200
_TAGS = re.compile(r"<(script|style)\b.*?</\1\s*>|<[^>]*>", re.IGNORECASE | re.DOTALL)
_SPACE = re.compile(r"\s+")
_ADDRESS = re.compile(r"^[^\s<>\x00-\x1f\x7f,;:\"@]+@[^\s<>\x00-\x1f\x7f,;:\"@]+$")


@dataclass(frozen=True, slots=True)
class ParsedMessage:
    subject: str
    sender: Address | None
    to: tuple[Address, ...]
    cc: tuple[Address, ...]
    bcc: tuple[Address, ...]
    reply_to: tuple[Address, ...]
    date: datetime | None
    rfc822_message_id: str | None
    in_reply_to: str | None
    references: str | None
    body_html: str | None
    body_text: str | None
    snippet: str
    attachments: tuple[ProviderAttachment, ...]


def _parse(raw: bytes) -> EmailMessage:
    return message_from_bytes(raw, policy=policy.default)


def _header(message: Message, name: str) -> str:
    """Decoded header value (RFC 2047), single line. Never raises."""
    try:
        value = message.get(name)
        text = "" if value is None else str(value)
    except Exception:
        return ""
    return _SPACE.sub(" ", text.replace("\x00", "")).strip()


def _clean_address(email: str, name: str | None) -> Address | None:
    email = email.strip().lower()
    if "@" not in email or len(email) > 320 or not _ADDRESS.match(email):
        return None
    return Address(email=email, name=(name or "").strip()[:200] or None)


def _addresses(message: Message, name: str) -> tuple[Address, ...]:
    result: list[Address] = []
    try:
        headers = message.get_all(name) or []
        for header in headers:
            parsed = getattr(header, "addresses", None)
            if parsed is None:
                pairs = getaddresses([str(header)])
            else:
                pairs = [(a.display_name, a.addr_spec) for a in parsed]
            for display, email in pairs:
                address = _clean_address(email, display)
                if address is not None:
                    result.append(address)
    except Exception:
        # A header the parser cannot digest: fall back to the lenient legacy splitter.
        try:
            raw = [str(v) for v in message.get_all(name, [])]  # may raise again
        except Exception:
            raw = []
        for display, email in getaddresses(raw):
            address = _clean_address(email, display)
            if address is not None:
                result.append(address)
    return tuple(result[:MAX_ADDRESSES])


def _date(message: Message) -> datetime | None:
    try:
        raw = message.get("Date")
        if raw is None:
            return None
        parsed = getattr(raw, "datetime", None) or parsedate_to_datetime(str(raw))
    except Exception:
        return None
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    try:
        return parsed.astimezone(UTC)
    except (OverflowError, ValueError):
        return None


def effective_date(header_date: datetime | None, internal_date: datetime) -> datetime:
    """The ``Date`` header when it is plausible, else the server's arrival time."""
    if header_date is None or header_date > internal_date + timedelta(days=1):
        return internal_date
    if header_date.year < 1990:
        return internal_date
    return header_date


def _text(part: Message) -> str:
    """Decode a text part with its declared charset, tolerating unknown or wrong ones."""
    try:
        payload = part.get_payload(decode=True)
    except Exception:
        payload = None
    if not isinstance(payload, bytes):
        return ""
    payload = payload[:MAX_BODY_BYTES]
    charset = part.get_content_charset() or "utf-8"
    try:
        text = payload.decode(charset, errors="replace")
    except (LookupError, ValueError):
        text = payload.decode("utf-8", errors="replace")
    return text.rstrip("\r\n")  # the line break that ends the MIME part is not content


def _filename(part: Message) -> str:
    try:
        return (part.get_filename() or "").replace("\x00", "").strip()
    except Exception:
        return ""


def _disposition(part: Message) -> str:
    try:
        return (part.get_content_disposition() or "").lower()
    except Exception:
        return ""


def _children(part: Message) -> list[Message]:
    payload = part.get_payload() if part.is_multipart() else None
    return [p for p in payload if isinstance(p, Message)] if isinstance(payload, list) else []


def _walk(root: Message) -> list[tuple[str, Message]]:
    """Leaf parts with IMAP-style part numbers (``1``, ``1.2``, ``2.1.3``).

    The numbering depends only on the MIME structure, so it is stable between fetches of the
    same message. An embedded ``message/rfc822`` is one leaf (an attachment), not descended.
    """
    result: list[tuple[str, Message]] = []

    def visit(part: Message, number: str) -> None:
        if len(result) >= MAX_PARTS:
            return
        if part.get_content_maintype() == "multipart":
            for index, child in enumerate(_children(part), start=1):
                visit(child, f"{number}.{index}" if number else str(index))
        else:
            result.append((number or "1", part))

    visit(root, "")
    return result


def _part_bytes(part: Message) -> bytes:
    if part.get_content_type() == "message/rfc822":
        inner = part.get_payload()
        if isinstance(inner, list) and inner and isinstance(inner[0], Message):
            return inner[0].as_bytes()
        return b""
    payload = part.get_payload(decode=True)
    return payload if isinstance(payload, bytes) else b""


def _snippet(text: str | None, markup: str | None) -> str:
    source = text or ""
    if not source.strip() and markup:
        source = html.unescape(_TAGS.sub(" ", markup[:50_000]))
    return _SPACE.sub(" ", source[:5_000].replace("\x00", "")).strip()[:SNIPPET_CHARS]


def parse_message(raw: bytes) -> ParsedMessage:
    message = _parse(raw)
    body_text: str | None = None
    body_html: str | None = None
    attachments: list[ProviderAttachment] = []
    for number, part in _walk(message):
        content_type = part.get_content_type()
        filename = _filename(part)
        disposition = _disposition(part)
        is_body = not filename and disposition != "attachment"
        if is_body and content_type == "text/plain" and body_text is None:
            body_text = _text(part)
        elif is_body and content_type == "text/html" and body_html is None:
            body_html = _text(part)
        else:
            content_id = _header(part, "Content-ID").strip("<> ") or None
            if content_type == "message/rfc822" and not filename:
                filename = "message.eml"
            try:
                size = len(_part_bytes(part))
            except Exception:
                size = 0
            attachments.append(
                ProviderAttachment(
                    part_id=number,
                    filename=filename,
                    mime_type=content_type or "application/octet-stream",
                    size=size,
                    content_id=content_id,
                    is_inline=disposition != "attachment" and content_id is not None,
                )
            )
    senders = _addresses(message, "From")
    return ParsedMessage(
        subject=_header(message, "Subject")[:998],
        sender=senders[0] if senders else None,
        to=_addresses(message, "To"),
        cc=_addresses(message, "Cc"),
        bcc=_addresses(message, "Bcc"),
        reply_to=_addresses(message, "Reply-To"),
        date=_date(message),
        rfc822_message_id=_header(message, "Message-ID")[:998] or None,
        in_reply_to=_header(message, "In-Reply-To")[:998] or None,
        references=_header(message, "References") or None,
        body_html=body_html,
        body_text=body_text,
        snippet=_snippet(body_text, body_html),
        attachments=tuple(attachments),
    )


def extract_part(raw: bytes, part_id: str) -> bytes | None:
    """Decoded bytes of the leaf part numbered ``part_id``; ``None`` when there is none."""
    for number, part in _walk(_parse(raw)):
        if number == part_id:
            try:
                return _part_bytes(part)
            except Exception:
                return None
    return None


# -- outgoing ------------------------------------------------------------------------------


def envelope_address(email: str) -> str:
    """Validate an address before it is used in ``MAIL FROM`` / ``RCPT TO``.

    SMTP commands are lines: an address carrying CR, LF or a space could smuggle a second
    command, so anything but a plain ``local@domain`` is refused.
    """
    if not _ADDRESS.match(email) or len(email) > 320:
        raise ProviderError("invalid envelope address")
    return email


def _format(addresses: tuple[Address, ...]) -> str:
    return ", ".join(formataddr((_one_line(a.name or ""), a.email)) for a in addresses)


def _one_line(value: str) -> str:
    return " ".join(value.replace("\x00", "").split())


def build_message(message: OutgoingMessage) -> EmailMessage:
    """Build an RFC 5322 message. Every header value is made single-line and goes through
    ``email``'s structured headers, so user input cannot add headers."""
    mime = EmailMessage(policy=policy.SMTP)
    mime["From"] = formataddr((_one_line(message.sender.name or ""), message.sender.email))
    if message.to:
        mime["To"] = _format(message.to)
    if message.cc:
        mime["Cc"] = _format(message.cc)
    if message.bcc:
        mime["Bcc"] = _format(message.bcc)
    mime["Subject"] = _one_line(message.subject)
    mime["Date"] = format_datetime(datetime.now(UTC))
    mime["Message-ID"] = make_msgid(domain=message.sender.email.rsplit("@", 1)[-1])
    if message.in_reply_to:
        mime["In-Reply-To"] = _one_line(message.in_reply_to)
    if message.references:
        mime["References"] = _one_line(message.references)
    mime.set_content(message.body_text or " ")
    mime.add_alternative(message.body_html, subtype="html")
    for attachment in message.attachments:
        maintype, _, subtype = attachment.mime_type.partition("/")
        mime.add_attachment(
            attachment.content,
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=_one_line(attachment.filename),
        )
    return mime


def recipients(message: OutgoingMessage) -> list[str]:
    seen = dict.fromkeys(a.email for a in (*message.to, *message.cc, *message.bcc))
    return [envelope_address(email) for email in seen]


def wire_bytes(mime: EmailMessage, *, include_bcc: bool) -> bytes:
    """Serialized message. The copy handed to SMTP must not disclose Bcc recipients."""
    if include_bcc or "Bcc" not in mime:
        return mime.as_bytes()
    bcc = mime["Bcc"]
    del mime["Bcc"]
    try:
        return mime.as_bytes()
    finally:
        mime["Bcc"] = bcc
