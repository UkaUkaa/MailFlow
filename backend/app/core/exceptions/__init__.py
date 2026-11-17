"""Uniform error envelope and mapping from domain errors to HTTP."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger
from app.shared.domain import errors as e

logger = get_logger(__name__)

_STATUS: dict[type[e.DomainError], int] = {
    e.NotFoundError: 404,
    e.ConflictError: 409,
    e.InvalidInputError: 422,
    e.UnsupportedError: 422,
    e.UnauthenticatedError: 401,
    e.InvalidCredentialsError: 401,
    e.EmailNotVerifiedError: 403,
    e.ForbiddenError: 403,
    e.PayloadTooLargeError: 413,
    e.RateLimitedError: 429,
    e.ProviderAuthRequiredError: 409,
    e.ProviderNotConfiguredError: 503,
    e.ProviderUnavailableError: 502,
    e.ProviderRateLimitedError: 503,
}
_HTTP_CODES = {
    400: "bad_request", 401: "unauthenticated", 403: "forbidden", 404: "not_found",
    405: "method_not_allowed", 413: "payload_too_large", 415: "unsupported_media_type",
    429: "rate_limited",
}  # fmt: skip


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: list[dict[str, Any]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=body, headers=headers)


def _status_for(exc: e.DomainError) -> int:
    for cls in type(exc).__mro__:
        if cls in _STATUS:
            return _STATUS[cls]
    return 400


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(e.DomainError)
    async def _domain(_: Request, exc: e.DomainError) -> JSONResponse:
        headers = None
        details = None
        if isinstance(exc, e.RateLimitedError):
            headers = {"Retry-After": str(exc.retry_after)}
        if isinstance(exc, e.InvalidInputError) and exc.problems:
            details = [{"field": p.field, "code": p.code} for p in exc.problems]
        return error_response(_status_for(exc), exc.code, exc.message, details, headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {
                "field": ".".join(str(p) for p in err["loc"] if p not in ("body", "query")),
                "code": str(err["type"]),
            }
            for err in exc.errors()
        ]
        return error_response(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "validation_error",
            "The submitted data is invalid.",
            details,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "error")
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return error_response(exc.status_code, code, message, headers=dict(exc.headers or {}))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Never leak internals; the request id lets operators find the trace.
        logger.error("unhandled_exception", path=request.url.path, exc_info=exc)
        return error_response(500, "internal_error", "An unexpected error occurred.")
