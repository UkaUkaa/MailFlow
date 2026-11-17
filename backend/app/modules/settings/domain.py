from __future__ import annotations

from dataclasses import dataclass

LOCALES = ("en", "uk")
THEMES = ("system", "light", "dark")


@dataclass(slots=True)
class UserSettings:
    locale: str = "en"
    theme: str = "system"
    load_remote_images: bool = False
    conversation_view: bool = True
