from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import Auth, Svc
from app.core.dependencies import SettingsDep
from app.modules.authentication.presentation.router import user_response
from app.modules.authentication.presentation.schemas import UserResponse

router = APIRouter(prefix="/users", tags=["users"])


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field(min_length=1, max_length=100)


class PasswordConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=1024)


class DeleteAccountRequest(PasswordConfirmation):
    confirmation: Literal["DELETE"]


@router.get("/me", response_model=UserResponse)
async def get_me(auth: Auth, svc: Svc) -> UserResponse:
    return user_response(await svc.profile.get(auth.user_id))


@router.patch("/me", response_model=UserResponse)
async def update_me(body: ProfileUpdate, auth: Auth, svc: Svc) -> UserResponse:
    return user_response(await svc.profile.rename(auth.user_id, body.display_name))


@router.post("/me/deactivate", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate(
    body: PasswordConfirmation, auth: Auth, svc: Svc, response: Response, settings: SettingsDep
) -> None:
    await svc.lifecycle.deactivate(auth.user_id, body.password)
    response.delete_cookie(settings.session_cookie_name, path="/", domain=settings.cookie_domain)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    body: DeleteAccountRequest, auth: Auth, svc: Svc, response: Response, settings: SettingsDep
) -> None:
    await svc.lifecycle.delete(auth.user_id, body.password)
    response.delete_cookie(settings.session_cookie_name, path="/", domain=settings.cookie_domain)
