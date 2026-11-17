"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.bootstrap import Runtime
from app.core.config import Settings, get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.middleware import (
    BodySizeLimitMiddleware,
    CSRFMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from app.modules.attachments.presentation import router as attachments_router
from app.modules.authentication.presentation.router import router as auth_router
from app.modules.email_accounts.presentation.router import router as accounts_router
from app.modules.emails.presentation.router import emails_router, threads_router
from app.modules.folders.presentation import router as folders_router
from app.modules.search.presentation import router as search_router
from app.modules.settings.presentation import router as settings_router
from app.modules.synchronization.presentation import router as sync_router
from app.modules.users.presentation import router as users_router

logger = get_logger(__name__)


def create_app(settings: Settings | None = None, runtime: Runtime | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json=settings.environment != "development")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        owned = runtime is None
        rt = runtime
        if rt is None:
            from app.infrastructure.celery.queue import CelerySyncQueue

            rt = Runtime.create(settings, sync_queue=CelerySyncQueue())
        app.state.runtime = rt
        app.state.session_factory = rt.session_factory
        app.state.redis = rt.redis
        yield
        if owned:
            await rt.close()

    docs = settings.api_docs_enabled or not settings.is_production
    app = FastAPI(
        title="MailFlow API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs" if docs else None,
        openapi_url="/api/openapi.json" if docs else None,
        redoc_url=None,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    if runtime is not None:  # injected runtime (tests): available without running lifespan
        app.state.runtime = runtime
        app.state.session_factory = runtime.session_factory
        app.state.redis = runtime.redis
    register_exception_handlers(app)

    # Starlette runs the last-added middleware first.
    app.add_middleware(CSRFMiddleware, settings=settings)
    app.add_middleware(SecurityHeadersMiddleware, settings=settings)
    if settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=sorted(settings.trusted_origins),
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
        )
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    app.add_middleware(RequestContextMiddleware)

    health = APIRouter(prefix="/api/health", tags=["health"])

    @health.get("/live")
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @health.get("/ready")
    async def ready() -> JSONResponse:
        rt: Runtime = app.state.runtime
        checks = {"database": False, "redis": False}
        try:
            async with rt.session_factory() as session:
                await session.execute(text("SELECT 1"))
            checks["database"] = True
        except Exception as exc:
            logger.error("readiness_database_failed", error=type(exc).__name__)
        try:
            checks["redis"] = bool(await rt.redis.ping())
        except Exception as exc:
            logger.error("readiness_redis_failed", error=type(exc).__name__)
        ok = all(checks.values())
        return JSONResponse(
            {"status": "ok" if ok else "unavailable", "checks": checks},
            status_code=200 if ok else 503,
        )

    api = APIRouter(prefix="/api/v1")
    for router in (
        auth_router,
        users_router,
        settings_router,
        accounts_router,
        sync_router,
        folders_router,
        threads_router,
        emails_router,
        attachments_router,
        search_router,
    ):
        api.include_router(router)
    app.include_router(health)
    app.include_router(api)
    return app


app = create_app()
