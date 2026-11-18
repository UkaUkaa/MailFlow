"""Composition root for authentication and the ``require_auth`` gate used by every module."""

from __future__ import annotations

from datetime import timedelta
from functools import lru_cache
from typing import Annotated, cast

import httpx
from fastapi import BackgroundTasks, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.database.engine import set_tenant
from app.core.dependencies import (
    DbSession,
    RedisDep,
    SettingsDep,
    get_clock,
    get_rate_limiter,
)
from app.core.security.passwords import Argon2PasswordHasher
from app.core.security.tokens import generate_token, hash_token
from app.infrastructure.mailer import build_mailer
from app.infrastructure.redis import RedisRateLimiter
from app.modules.audit.infrastructure import SqlAuditLog
from app.modules.authentication.application.external_sign_in import ExternalSignInService
from app.modules.authentication.application.services import (
    AuthPolicy,
    PasswordService,
    RegistrationService,
    SessionService,
    TokenFactory,
)
from app.modules.authentication.domain.entities import AuthContext
from app.modules.authentication.infrastructure.google_sign_in import GoogleSignInClient
from app.modules.authentication.infrastructure.notifier import EmailAuthNotifier
from app.modules.authentication.infrastructure.repositories import (
    SqlIdentityRepository,
    SqlOneTimeTokenRepository,
    SqlSessionRepository,
)
from app.modules.authentication.infrastructure.sign_in_states import RedisSignInStateStore
from app.modules.users.infrastructure import SqlUserRepository
from app.shared.domain.errors import UnauthenticatedError

Limiter = Annotated[RedisRateLimiter, Depends(get_rate_limiter)]


@lru_cache
def get_password_hasher() -> Argon2PasswordHasher:
    return Argon2PasswordHasher()


def get_token_factory() -> TokenFactory:
    return TokenFactory(generate_token, hash_token)


def auth_policy(settings: Settings) -> AuthPolicy:
    return AuthPolicy(
        session_ttl=timedelta(hours=settings.session_ttl_hours),
        session_idle_timeout=timedelta(hours=settings.session_idle_timeout_hours),
        verification_ttl=timedelta(hours=settings.verification_token_ttl_hours),
        reset_ttl=timedelta(minutes=settings.password_reset_token_ttl_minutes),
        require_email_verification=settings.require_email_verification,
    )


def get_audit_log(request: Request) -> SqlAuditLog:
    factory = cast(async_sessionmaker[AsyncSession], request.app.state.session_factory)
    return SqlAuditLog(factory)


AuditDep = Annotated[SqlAuditLog, Depends(get_audit_log)]


def get_notifier(settings: SettingsDep, background: BackgroundTasks) -> EmailAuthNotifier:
    return EmailAuthNotifier(
        build_mailer(settings),
        base_url=settings.app_base_url,
        verification_hours=settings.verification_token_ttl_hours,
        reset_minutes=settings.password_reset_token_ttl_minutes,
        defer=background.add_task,
    )


def get_session_service(
    db: DbSession, settings: SettingsDep, limiter: Limiter, audit: AuditDep
) -> SessionService:
    return SessionService(
        SqlUserRepository(db),
        SqlSessionRepository(db),
        get_password_hasher(),
        get_token_factory(),
        limiter,
        audit,
        get_clock(),
        auth_policy(settings),
    )


def get_registration_service(
    db: DbSession,
    settings: SettingsDep,
    limiter: Limiter,
    audit: AuditDep,
    notifier: Annotated[EmailAuthNotifier, Depends(get_notifier)],
) -> RegistrationService:
    return RegistrationService(
        SqlUserRepository(db),
        SqlOneTimeTokenRepository(db),
        get_password_hasher(),
        notifier,
        get_token_factory(),
        limiter,
        audit,
        get_clock(),
        auth_policy(settings),
    )


def get_password_service(
    db: DbSession,
    settings: SettingsDep,
    limiter: Limiter,
    audit: AuditDep,
    notifier: Annotated[EmailAuthNotifier, Depends(get_notifier)],
) -> PasswordService:
    return PasswordService(
        SqlUserRepository(db),
        SqlSessionRepository(db),
        SqlOneTimeTokenRepository(db),
        get_password_hasher(),
        notifier,
        get_token_factory(),
        limiter,
        audit,
        get_clock(),
        auth_policy(settings),
    )


SessionServiceDep = Annotated[SessionService, Depends(get_session_service)]


def get_google_sign_in(request: Request, settings: SettingsDep) -> GoogleSignInClient:
    return GoogleSignInClient(
        cast(httpx.AsyncClient, request.app.state.runtime.http),
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret.get_secret_value(),
        redirect_uri=settings.google_sign_in_redirect_uri,
    )


def get_google_sign_in_service(
    db: DbSession,
    redis: RedisDep,
    audit: AuditDep,
    sessions: SessionServiceDep,
    provider: Annotated[GoogleSignInClient, Depends(get_google_sign_in)],
) -> ExternalSignInService:
    return ExternalSignInService(
        provider,
        RedisSignInStateStore(redis),
        SqlIdentityRepository(db),
        SqlUserRepository(db),
        sessions,
        SqlSessionRepository(db),
        get_password_hasher(),
        audit,
        get_clock(),
    )


GoogleSignInDep = Annotated[ExternalSignInService, Depends(get_google_sign_in_service)]


async def require_auth(
    request: Request, db: DbSession, settings: SettingsDep, sessions: SessionServiceDep
) -> AuthContext:
    """Authenticate the request and bind its transaction to the tenant.

    This is the single place where the acting user is established. Handlers must use the
    returned context and never accept a user identifier from the client.
    """
    auth = await sessions.authenticate(request.cookies.get(settings.session_cookie_name))
    if auth is None:
        raise UnauthenticatedError
    await set_tenant(db, auth.user_id)
    return auth


Auth = Annotated[AuthContext, Depends(require_auth)]
