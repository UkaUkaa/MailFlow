"""System mail transport (verification, password reset). Not used for users' own mail."""

from __future__ import annotations

from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr
from typing import Protocol

import aiosmtplib

from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class Mailer(Protocol):
    async def send(self, *, to: str, subject: str, text: str) -> None: ...


def build_message(*, sender: str, to: str, subject: str, text: str) -> EmailMessage:
    """A plain-text message with the headers receiving servers expect (Date, Message-ID)."""
    message = EmailMessage()
    message["From"] = sender
    message["To"] = to
    message["Subject"] = subject
    message["Date"] = formatdate(localtime=False, usegmt=True)
    domain = parseaddr(sender)[1].rpartition("@")[2] or None
    message["Message-ID"] = make_msgid(domain=domain)
    message["Auto-Submitted"] = "auto-generated"
    message.set_content(text)
    return message


class SmtpMailer:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    async def send(self, *, to: str, subject: str, text: str) -> None:
        message = build_message(sender=self._s.mail_from, to=to, subject=subject, text=text)
        await aiosmtplib.send(
            message,
            hostname=self._s.smtp_host,
            port=self._s.smtp_port,
            username=self._s.smtp_username or None,
            password=self._s.smtp_password.get_secret_value() or None,
            use_tls=self._s.smtp_tls,
            start_tls=self._s.smtp_starttls,
            timeout=15,
        )
        logger.info("system_mail_sent", subject=subject)


class UnconfiguredMailer:
    """Used when SMTP is not configured: reports the fact, never logs message content."""

    async def send(self, *, to: str, subject: str, text: str) -> None:
        logger.warning("mail_not_sent_smtp_unconfigured", subject=subject)


def build_mailer(settings: Settings) -> Mailer:
    return SmtpMailer(settings) if settings.smtp_host else UnconfiguredMailer()
