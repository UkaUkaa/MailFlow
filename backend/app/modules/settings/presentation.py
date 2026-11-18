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
    list_density: Literal["comfortable", "compact"]
    list_preview_lines: Literal[0, 1, 2]
    show_avatars: bool
    account_tint: Literal["off", "subtle", "strong"]
    accent_color: Literal["blue", "violet", "green", "orange", "pink", "graphite"]
    reader_text_size: Literal["small", "default", "large"]


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    locale: Literal["en", "uk"] | None = None
    theme: Literal["system", "light", "dark"] | None = None
    load_remote_images: bool | None = None
    conversation_view: bool | None = None
    list_density: Literal["comfortable", "compact"] | None = None
    list_preview_lines: Literal[0, 1, 2] | None = None
    show_avatars: bool | None = None
    account_tint: Literal["off", "subtle", "strong"] | None = None
    accent_color: Literal["blue", "violet", "green", "orange", "pink", "graphite"] | None = None
    reader_text_size: Literal["small", "default", "large"] | None = None


@router.get("", response_model=SettingsResponse)
async def get_settings(auth: Auth, db: DbSession) -> SettingsResponse:
    current = await SettingsService(SqlSettingsRepository(db)).get(auth.user_id)
    return SettingsResponse(**asdict(current))


@router.patch("", response_model=SettingsResponse)
async def update_settings(body: SettingsUpdate, auth: Auth, db: DbSession) -> SettingsResponse:
    changes = body.model_dump(exclude_none=True)
    updated = await SettingsService(SqlSettingsRepository(db)).update(auth.user_id, changes)
    return SettingsResponse(**asdict(updated))
