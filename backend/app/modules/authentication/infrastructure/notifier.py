"""Builds and sends authentication emails."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from urllib.parse import quote

from app.core.logging import get_logger
from app.infrastructure.mailer import Mailer

logger = get_logger(__name__)

# Runs a coroutine function after the HTTP response has been sent (FastAPI background tasks).
Deferrer = Callable[[Callable[[], Awaitable[None]]], None]

_TEXT = {
    "en": {
        "verify_subject": "Confirm your MailFlow email address",
        "verify_body": "Welcome to MailFlow.\n\nConfirm your email address by opening this link:\n"
        "{link}\n\nThe link expires in {hours} hours. If you did not create an account, ignore "
        "this message.",
        "reset_subject": "Reset your MailFlow password",
        "reset_body": "A password reset was requested for your MailFlow account.\n\nChoose a new "
        "password here:\n{link}\n\nThe link expires in {minutes} minutes. If you did not request "
        "this, ignore this message; your password stays unchanged.",
    },
    "uk": {
        "verify_subject": "Підтвердьте адресу електронної пошти MailFlow",
        "verify_body": "Вітаємо в MailFlow.\n\nПідтвердьте адресу електронної пошти за "
        "посиланням:\n{link}\n\nПосилання дійсне {hours} год. Якщо ви не створювали обліковий "
        "запис, проігноруйте цей лист.",
        "reset_subject": "Скидання пароля MailFlow",
        "reset_body": "Надійшов запит на скидання пароля вашого облікового запису MailFlow.\n\n"
        "Встановіть новий пароль за посиланням:\n{link}\n\nПосилання дійсне {minutes} хв. Якщо "
        "ви не надсилали цей запит, проігноруйте лист — пароль не зміниться.",
    },
}


class EmailAuthNotifier:
    def __init__(
        self,
        mailer: Mailer,
        *,
        base_url: str,
        verification_hours: int,
        reset_minutes: int,
        defer: Deferrer | None = None,
    ) -> None:
        self._mailer = mailer
        self._defer = defer
        self._base_url = base_url
        self._hours = verification_hours
        self._minutes = reset_minutes

    def _link(self, locale: str, path: str, token: str) -> str:
        return f"{self._base_url}/{locale}/{path}?token={quote(token, safe='')}"

    async def _deliver(self, *, to: str, subject: str, text: str) -> None:
        # Delivery problems must not change the HTTP outcome (that would reveal which
        # addresses exist); the user can request a new message.
        try:
            await self._mailer.send(to=to, subject=subject, text=text)
        except Exception as exc:
            logger.error("auth_mail_failed", error=type(exc).__name__)

    async def _send(self, *, to: str, subject: str, text: str) -> None:
        if self._defer is None:
            await self._deliver(to=to, subject=subject, text=text)
            return

        # A real SMTP round trip takes long enough to be measurable; sending after the
        # response keeps registration and reset timing identical for known/unknown addresses.
        async def job() -> None:
            await self._deliver(to=to, subject=subject, text=text)

        self._defer(job)

    async def send_verification(self, *, to: str, token: str, locale: str) -> None:
        text = _TEXT.get(locale, _TEXT["en"])
        await self._send(
            to=to,
            subject=text["verify_subject"],
            text=text["verify_body"].format(
                link=self._link(locale, "verify-email", token), hours=self._hours
            ),
        )

    async def send_password_reset(self, *, to: str, token: str, locale: str) -> None:
        text = _TEXT.get(locale, _TEXT["en"])
        await self._send(
            to=to,
            subject=text["reset_subject"],
            text=text["reset_body"].format(
                link=self._link(locale, "reset-password", token), minutes=self._minutes
            ),
        )
