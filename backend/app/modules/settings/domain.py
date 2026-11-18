from __future__ import annotations

from dataclasses import dataclass

LOCALES = ("en", "uk")
THEMES = ("system", "light", "dark")

# Interface preferences: how the message list and the reader look.
LIST_DENSITIES = ("comfortable", "compact")
PREVIEW_LINES = (0, 1, 2)
ACCOUNT_TINTS = ("off", "subtle", "strong")
ACCENT_COLORS = ("blue", "violet", "green", "orange", "pink", "graphite")
READER_TEXT_SIZES = ("small", "default", "large")
# Undo send: how long a sent message waits in the outbox before it really goes out. 0 = off.
UNDO_SEND_SECONDS = (0, 5, 10, 20, 30)

# Allowed values per enumerated field, used for validation in the application layer.
CHOICES: dict[str, tuple[object, ...]] = {
    "locale": LOCALES,
    "theme": THEMES,
    "list_density": LIST_DENSITIES,
    "list_preview_lines": PREVIEW_LINES,
    "account_tint": ACCOUNT_TINTS,
    "accent_color": ACCENT_COLORS,
    "reader_text_size": READER_TEXT_SIZES,
    "undo_send_seconds": UNDO_SEND_SECONDS,
}


@dataclass(slots=True)
class UserSettings:
    locale: str = "en"
    theme: str = "system"
    load_remote_images: bool = True
    conversation_view: bool = True
    list_density: str = "comfortable"
    list_preview_lines: int = 1
    show_avatars: bool = True
    account_tint: str = "subtle"
    accent_color: str = "blue"
    reader_text_size: str = "default"
    undo_send_seconds: int = 5
