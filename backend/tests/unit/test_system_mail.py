"""System mail: message headers, SMTP settings validation, deferred delivery."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.infrastructure.mailer import UnconfiguredMailer, build_mailer, build_message
from app.modules.authentication.infrastructure.notifier import EmailAuthNotifier

_PROD: dict[str, Any] = {
    "environment": "production",
    "app_base_url": "https://mail.example.com",
    "vault_keys": "k1:" + "A" * 44,
    "database_url": "postgresql+asyncpg://app:secret@db/mailflow",
    "smtp_host": "smtp.example.com",
    "smtp_port": 587,
    "smtp_starttls": True,
}


def _settings(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def test_message_has_delivery_headers() -> None:
    message = build_message(
        sender="MailFlow <no-reply@mailflow.example>",
        to="user@example.com",
        subject="Confirm",
        text="Body",
    )
    assert message["Date"]
    assert message["Message-ID"].endswith("@mailflow.example>")
    assert message["Auto-Submitted"] == "auto-generated"
    assert message.get_content().strip() == "Body"


def test_production_accepts_real_smtp() -> None:
    assert _settings(**_PROD).smtp_host == "smtp.example.com"
    implicit = _settings(**{**_PROD, "smtp_port": 465, "smtp_starttls": False, "smtp_tls": True})
    assert implicit.smtp_tls


@pytest.mark.parametrize("host", ["", "mailpit", "localhost", "127.0.0.1"])
def test_production_rejects_mail_catchers(host: str) -> None:
    with pytest.raises(ValidationError, match="SMTP_HOST"):
        _settings(**{**_PROD, "smtp_host": host})


def test_production_requires_encrypted_smtp() -> None:
    with pytest.raises(ValidationError, match="SMTP_STARTTLS or SMTP_TLS"):
        _settings(**{**_PROD, "smtp_starttls": False})


def test_starttls_and_implicit_tls_are_exclusive() -> None:
    with pytest.raises(ValidationError, match="mutually exclusive"):
        _settings(smtp_starttls=True, smtp_tls=True)


def test_development_without_smtp_uses_unconfigured_mailer() -> None:
    assert isinstance(build_mailer(_settings(smtp_host="")), UnconfiguredMailer)


class _RecordingMailer:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[tuple[str, str]] = []
        self._fail = fail

    async def send(self, *, to: str, subject: str, text: str) -> None:
        if self._fail:
            raise OSError("connection refused")
        self.sent.append((to, text))


async def test_verification_is_sent_after_the_response() -> None:
    jobs: list[Callable[[], Awaitable[None]]] = []
    mailer = _RecordingMailer()
    notifier = EmailAuthNotifier(
        mailer,
        base_url="https://mail.example.com",
        verification_hours=24,
        reset_minutes=30,
        defer=jobs.append,
    )
    await notifier.send_verification(to="user@example.com", token="t/k+n", locale="uk")
    assert mailer.sent == []  # nothing sent inside the request
    assert len(jobs) == 1
    await jobs[0]()
    to, text = mailer.sent[0]
    assert to == "user@example.com"
    assert "https://mail.example.com/uk/verify-email?token=t%2Fk%2Bn" in text


async def test_deferred_delivery_failure_is_swallowed() -> None:
    jobs: list[Callable[[], Awaitable[None]]] = []
    notifier = EmailAuthNotifier(
        _RecordingMailer(fail=True),
        base_url="https://mail.example.com",
        verification_hours=24,
        reset_minutes=30,
        defer=jobs.append,
    )
    await notifier.send_password_reset(to="user@example.com", token="t", locale="en")
    await jobs[0]()  # must not raise
