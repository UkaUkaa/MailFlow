from __future__ import annotations

from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.core.dependencies import DbSession
from app.modules.authentication.presentation.dependencies import Auth
from app.modules.settings.application import SettingsService
from app.modules.settings.infrastructure import SqlSettingsRepository

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    locale: Literal["en", "uk"]
    theme: Literal["system", "light", "dark"]
    load_remote_images: bool
    conversation_view: bool


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    locale: Literal["en", "uk"] | None = None
    theme: Literal["system", "light", "dark"] | None = None
    load_remote_images: bool | None = None
    conversation_view: bool | None = None


@router.get("", response_model=SettingsResponse)
async def get_settings(auth: Auth, db: DbSession) -> SettingsResponse:
    current = await SettingsService(SqlSettingsRepository(db)).get(auth.user_id)
    return SettingsResponse(**asdict(current))


@router.patch("", response_model=SettingsResponse)
async def update_settings(body: SettingsUpdate, auth: Auth, db: DbSession) -> SettingsResponse:
    changes = body.model_dump(exclude_none=True)
    updated = await SettingsService(SqlSettingsRepository(db)).update(auth.user_id, changes)
    return SettingsResponse(**asdict(updated))
