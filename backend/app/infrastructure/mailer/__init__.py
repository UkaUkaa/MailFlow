"""System mail transport (verification, password reset). Not used for users' own mail."""

from __future__ import annotations

from email.message import EmailMessage
from typing import Protocol

import aiosmtplib

from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class Mailer(Protocol):
    async def send(self, *, to: str, subject: str, text: str) -> None: ...


class SmtpMailer:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    async def send(self, *, to: str, subject: str, text: str) -> None:
        message = EmailMessage()
        message["From"] = self._s.mail_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(text)
        await aiosmtplib.send(
            message,
            hostname=self._s.smtp_host,
            port=self._s.smtp_port,
            username=self._s.smtp_username or None,
            password=self._s.smtp_password.get_secret_value() or None,
            start_tls=self._s.smtp_starttls,
            timeout=10,
        )


class UnconfiguredMailer:
    """Used when SMTP is not configured: reports the fact, never logs message content."""

    async def send(self, *, to: str, subject: str, text: str) -> None:
        logger.warning("mail_not_sent_smtp_unconfigured", subject=subject)


def build_mailer(settings: Settings) -> Mailer:
    return SmtpMailer(settings) if settings.smtp_host else UnconfiguredMailer()
