from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import Auth, Svc
from app.core.config import Settings
from app.core.dependencies import SettingsDep
from app.modules.authentication.presentation.router import (
    REAUTH_COOKIE,
    REAUTH_COOKIE_PATH,
    user_response,
)
from app.modules.authentication.presentation.schemas import UserResponse

router = APIRouter(prefix="/users", tags=["users"])


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field(min_length=1, max_length=100)


class AccountConfirmation(BaseModel):
    """The password, or nothing when a fresh Google re-confirmation cookie is present."""

    model_config = ConfigDict(extra="forbid")
    password: str | None = Field(default=None, min_length=1, max_length=1024)


class DeleteAccountRequest(AccountConfirmation):
    confirmation: Literal["DELETE"]


def _end(response: Response, settings: Settings) -> None:
    response.delete_cookie(settings.session_cookie_name, path="/", domain=settings.cookie_domain)
    response.delete_cookie(REAUTH_COOKIE, path=REAUTH_COOKIE_PATH, domain=settings.cookie_domain)


@router.get("/me", response_model=UserResponse)
async def get_me(auth: Auth, svc: Svc) -> UserResponse:
    return user_response(await svc.profile.get(auth.user_id))


@router.patch("/me", response_model=UserResponse)
async def update_me(body: ProfileUpdate, auth: Auth, svc: Svc) -> UserResponse:
    return user_response(await svc.profile.rename(auth.user_id, body.display_name))


@router.post("/me/deactivate", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate(
    body: AccountConfirmation,
    request: Request,
    auth: Auth,
    svc: Svc,
    response: Response,
    settings: SettingsDep,
) -> None:
    await svc.lifecycle.deactivate(
        auth.user_id, password=body.password, reauth_token=request.cookies.get(REAUTH_COOKIE)
    )
    _end(response, settings)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    body: DeleteAccountRequest,
    request: Request,
    auth: Auth,
    svc: Svc,
    response: Response,
    settings: SettingsDep,
) -> None:
    await svc.lifecycle.delete(
        auth.user_id, password=body.password, reauth_token=request.cookies.get(REAUTH_COOKIE)
    )
    _end(response, settings)
