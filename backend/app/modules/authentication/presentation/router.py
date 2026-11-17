from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.core.config import Settings
from app.core.dependencies import DbSession, SettingsDep, client_ip, rate_limit, user_agent
from app.core.security.tokens import generate_token
from app.modules.authentication.application.services import (
    PasswordService,
    RegistrationService,
)
from app.modules.authentication.presentation import schemas as s
from app.modules.authentication.presentation.dependencies import (
    Auth,
    SessionServiceDep,
    get_password_service,
    get_registration_service,
)
from app.modules.users.domain import User
from app.modules.users.infrastructure import SqlUserRepository  # composition: read model for /me
from app.shared.domain.errors import UnauthenticatedError

router = APIRouter(prefix="/auth", tags=["auth"])

Registration = Annotated[RegistrationService, Depends(get_registration_service)]
Passwords = Annotated[PasswordService, Depends(get_password_service)]


def user_response(user: User) -> s.UserResponse:
    return s.UserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        email_verified=user.email_verified,
        created_at=user.created_at,
    )


def _set_csrf_cookie(response: Response, settings: Settings) -> str:
    token = generate_token(24)
    response.set_cookie(
        settings.csrf_cookie_name,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=False,  # must be readable by the client to echo it in the header
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
        domain=settings.cookie_domain,
    )
    return token


def _set_session_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
        domain=settings.cookie_domain,
    )


def _clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(settings.session_cookie_name, path="/", domain=settings.cookie_domain)


@router.get("/csrf", response_model=s.CsrfResponse)
async def csrf(response: Response, settings: SettingsDep) -> s.CsrfResponse:
    return s.CsrfResponse(csrf_token=_set_csrf_cookie(response, settings))


@router.post(
    "/register",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=s.StatusResponse,
    dependencies=[Depends(rate_limit("register", limit=10, window_seconds=3600))],
)
async def register(body: s.RegisterRequest, service: Registration) -> s.StatusResponse:
    await service.register(
        email=body.email,
        password=body.password,
        display_name=body.display_name,
        locale=body.locale,
    )
    return s.StatusResponse(status="verification_required")


@router.post(
    "/verify-email",
    response_model=s.StatusResponse,
    dependencies=[Depends(rate_limit("verify", limit=30, window_seconds=3600))],
)
async def verify_email(body: s.TokenRequest, service: Registration) -> s.StatusResponse:
    await service.verify_email(body.token)
    return s.StatusResponse(status="verified")


@router.post(
    "/resend-verification",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=s.StatusResponse,
    dependencies=[Depends(rate_limit("verify-resend", limit=10, window_seconds=3600))],
)
async def resend_verification(body: s.EmailRequest, service: Registration) -> s.StatusResponse:
    await service.resend_verification(email=body.email, locale=body.locale)
    return s.StatusResponse(status="accepted")


@router.post(
    "/login",
    response_model=s.UserEnvelope,
    dependencies=[Depends(rate_limit("login", limit=30, window_seconds=900))],
)
async def login(
    body: s.LoginRequest,
    request: Request,
    response: Response,
    settings: SettingsDep,
    sessions: SessionServiceDep,
) -> s.UserEnvelope:
    user, token = await sessions.login(
        email=body.email,
        password=body.password,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    _set_session_cookie(response, settings, token)
    _set_csrf_cookie(response, settings)  # rotate on privilege change
    return s.UserEnvelope(user=user_response(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request, response: Response, settings: SettingsDep, sessions: SessionServiceDep
) -> None:
    auth = await sessions.authenticate(request.cookies.get(settings.session_cookie_name))
    if auth is not None:
        await sessions.logout(auth)
    _clear_session_cookie(response, settings)


@router.get("/me", response_model=s.UserEnvelope)
async def me(auth: Auth, db: DbSession) -> s.UserEnvelope:
    user = await SqlUserRepository(db).get_by_id(auth.user_id)
    if user is None:
        raise UnauthenticatedError
    return s.UserEnvelope(user=user_response(user))


@router.post(
    "/password/forgot",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=s.StatusResponse,
    dependencies=[Depends(rate_limit("pw-forgot", limit=10, window_seconds=3600))],
)
async def forgot_password(body: s.EmailRequest, service: Passwords) -> s.StatusResponse:
    await service.request_reset(email=body.email, locale=body.locale)
    return s.StatusResponse(status="accepted")


@router.post(
    "/password/reset",
    response_model=s.StatusResponse,
    dependencies=[Depends(rate_limit("pw-reset", limit=20, window_seconds=3600))],
)
async def reset_password(
    body: s.ResetPasswordRequest, response: Response, settings: SettingsDep, service: Passwords
) -> s.StatusResponse:
    await service.reset(token=body.token, new_password=body.new_password)
    _clear_session_cookie(response, settings)
    return s.StatusResponse(status="password_reset")


@router.post("/password/change", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(body: s.ChangePasswordRequest, auth: Auth, service: Passwords) -> None:
    await service.change(
        auth, current_password=body.current_password, new_password=body.new_password
    )


@router.get("/sessions", response_model=s.SessionList)
async def list_sessions(auth: Auth, sessions: SessionServiceDep) -> s.SessionList:
    items = await sessions.list_sessions(auth.user_id)
    return s.SessionList(
        items=[
            s.SessionResponse(
                id=i.id,
                created_at=i.created_at,
                last_seen_at=i.last_seen_at,
                expires_at=i.expires_at,
                user_agent=i.user_agent,
                ip_address=i.ip_address,
                is_current=i.id == auth.session_id,
            )
            for i in items
        ]
    )


@router.post("/sessions/revoke-others", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_other_sessions(auth: Auth, sessions: SessionServiceDep) -> None:
    await sessions.revoke_others(auth)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(session_id: uuid.UUID, auth: Auth, sessions: SessionServiceDep) -> None:
    await sessions.revoke(auth.user_id, session_id)
