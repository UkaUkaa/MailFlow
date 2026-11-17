"""Request-scoped access to use cases for authenticated routes."""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import Depends, Request

from app.bootstrap import Runtime, Services
from app.core.dependencies import DbSession
from app.modules.authentication.presentation.dependencies import Auth


def get_runtime(request: Request) -> Runtime:
    return cast(Runtime, request.app.state.runtime)


def get_services(request: Request, db: DbSession, auth: Auth) -> Services:
    """Depends on ``Auth`` so the session is already bound to the tenant before any use case
    runs; an unauthenticated request can never obtain a ``Services`` instance."""
    return Services(db, get_runtime(request))


Svc = Annotated[Services, Depends(get_services)]
__all__ = ["Auth", "Svc", "get_runtime", "get_services"]
