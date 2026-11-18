"""AI reply drafting: what the model is given and what comes back. Pure Python.

The model sees a trimmed copy of the conversation and a few of the user's own sent messages
(for tone and greeting/sign-off habits). Everything taken from mail is untrusted data; the
only instruction is the user's own short note.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

MAX_INSTRUCTION_LENGTH = 2000
MAX_MESSAGE_CHARS = 6000
MAX_THREAD_CHARS = 30000
MAX_STYLE_SAMPLES = 5
MAX_SAMPLE_CHARS = 1500
UNKNOWN_LANGUAGE = "und"

MAX_API_KEY_LENGTH = 512
_API_KEY = re.compile(r"^[\x21-\x7e]{8,512}$")


class AiProvider(StrEnum):
    """The AI services a user can connect with their own API key."""

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"


# Picked when the user does not choose a model: the first of these their key can use, otherwise
# the newest model the provider lists. The user can change it in settings.
PREFERRED_MODELS: dict[AiProvider, tuple[str, ...]] = {
    AiProvider.OPENAI: ("gpt-5", "gpt-4.1", "gpt-4o"),
    AiProvider.ANTHROPIC: ("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"),
    AiProvider.GEMINI: ("gemini-2.5-pro", "gemini-2.5-flash"),
}


@dataclass(frozen=True, slots=True)
class AssistantConfig:
    """What the user connected. The key itself lives only in the Token Vault."""

    provider: AiProvider
    model: str
    key_hint: str
    models: tuple[str, ...]


def is_plausible_api_key(value: str) -> bool:
    return bool(_API_KEY.match(value))


def key_hint(value: str) -> str:
    """The last four characters, enough to recognise a key without revealing it."""
    return value[-4:]


def default_model(provider: AiProvider, models: tuple[str, ...]) -> str:
    for preferred in PREFERRED_MODELS[provider]:
        if preferred in models:
            return preferred
    return models[0]


_LANGUAGE = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")

# Lines that start the quoted earlier message in a reply, in the clients and languages our
# users meet most. Everything from the first match on is dropped.
_QUOTE_HEADER = re.compile(
    r"^\s*("
    r"On .{3,200} wrote:"
    r"|.{3,200} (пише|писав|писала|написав|написала|написал|написала?\(а\)|пишет):"
    r"|-{2,}\s*(Original Message|Forwarded message|Пересланное сообщение|Пересланий лист|"
    r"Початкове повідомлення|Исходное сообщение)\s*-{2,}"
    r"|(From|Від|От):\s.+"
    r")\s*$",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class ThreadEntry:
    author_name: str
    author_email: str
    is_mine: bool
    sent_at: datetime
    text: str


@dataclass(frozen=True, slots=True)
class ReplyRequest:
    instruction: str
    subject: str
    my_name: str
    my_email: str
    correspondent_name: str
    correspondent_email: str
    thread: tuple[ThreadEntry, ...]
    omitted_messages: int
    style_samples: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ReplyDraft:
    language: str
    body: str


def strip_quoted(text: str) -> str:
    """The new part of a message: no ``>`` lines, nothing after a quote header."""
    kept: list[str] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        if _QUOTE_HEADER.match(line):
            break
        if line.lstrip().startswith(">"):
            continue
        kept.append(line.rstrip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


def clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def fit_thread(entries: list[ThreadEntry], budget: int) -> tuple[tuple[ThreadEntry, ...], int]:
    """Keep the newest messages that fit the character budget (oldest are dropped first).

    The most recent message is always kept, clipped if needed; returns the kept messages in
    time order and how many older ones were left out.
    """
    kept: list[ThreadEntry] = []
    used = 0
    for entry in reversed(entries):
        text = clip(entry.text, MAX_MESSAGE_CHARS)
        if kept and used + len(text) > budget:
            break
        if not kept:
            text = clip(text, budget)
        kept.append(_with_text(entry, text))
        used += len(text)
    kept.reverse()
    return tuple(kept), len(entries) - len(kept)


def _with_text(entry: ThreadEntry, text: str) -> ThreadEntry:
    return ThreadEntry(entry.author_name, entry.author_email, entry.is_mine, entry.sent_at, text)


def normalize_language(value: str) -> str:
    code = value.strip()
    return code if _LANGUAGE.match(code) else UNKNOWN_LANGUAGE


def as_data(value: str) -> str:
    """Mail text placed inside the prompt's data tags: no markup can close or open a tag."""
    return html.escape(value, quote=True)


def draft_to_html(text: str) -> str:
    """Plain text from the model -> safe composer HTML (paragraphs and line breaks only)."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text.replace("\r\n", "\n"))]
    return "".join(
        "<p>" + "<br>".join(html.escape(line) for line in p.split("\n")) + "</p>"
        for p in paragraphs
        if p
    )
