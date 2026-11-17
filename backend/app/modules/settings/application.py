from __future__ import annotations

import uuid
from dataclasses import replace
from typing import Protocol

from app.modules.settings.domain import LOCALES, THEMES, UserSettings
from app.shared.domain.errors import FieldProblem, InvalidInputError


class SettingsRepository(Protocol):
    async def get(self, user_id: uuid.UUID) -> UserSettings | None: ...
    async def save(self, user_id: uuid.UUID, settings: UserSettings) -> None: ...


class SettingsService:
    def __init__(self, repository: SettingsRepository) -> None:
        self._repo = repository

    async def get(self, user_id: uuid.UUID) -> UserSettings:
        return await self._repo.get(user_id) or UserSettings()

    async def update(self, user_id: uuid.UUID, changes: dict[str, object]) -> UserSettings:
        current = await self.get(user_id)
        if "locale" in changes and changes["locale"] not in LOCALES:
            raise InvalidInputError(problems=[FieldProblem("locale", "unsupported")])
        if "theme" in changes and changes["theme"] not in THEMES:
            raise InvalidInputError(problems=[FieldProblem("theme", "unsupported")])
        updated = replace(current, **changes)  # type: ignore[arg-type]
        await self._repo.save(user_id, updated)
        return updated
