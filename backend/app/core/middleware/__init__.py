"""HTTP middleware: request id, security headers, body-size limit, CSRF."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import Settings
from app.core.exceptions import error_response
from app.core.security.tokens import constant_time_equals

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
CSRF_HEADER = "x-csrf-token"
Next = Callable[[Request], Awaitable[Response]]


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Next) -> Response:
        request_id = uuid.uuid4().hex
        request.state.request_id = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """API responses are JSON or downloads; nothing here should ever be rendered as a page."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        super().__init__(app)
        self._hsts = settings.secure_cookies
        self._docs = settings.api_docs_enabled

    async def dispatch(self, request: Request, call_next: Next) -> Response:
        response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "no-referrer")
        headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        headers.setdefault("Cache-Control", "no-store")
        if not (self._docs and request.url.path.startswith("/api/docs")):
            headers.setdefault(
                "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
            )
        if self._hsts:
            headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response


class CSRFMiddleware(BaseHTTPMiddleware):
    """Double-submit cookie plus Origin allowlist for every state-changing request."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        super().__init__(app)
        self._cookie = settings.csrf_cookie_name
        self._origins = settings.trusted_origins

    async def dispatch(self, request: Request, call_next: Next) -> Response:
        if request.method in SAFE_METHODS:
            return await call_next(request)
        origin = request.headers.get("origin")
        if origin is not None and origin.rstrip("/") not in self._origins:
            return error_response(403, "csrf_failed", "Cross-site request rejected.")
        cookie = request.cookies.get(self._cookie)
        header = request.headers.get(CSRF_HEADER)
        if not cookie or not header or not constant_time_equals(cookie, header):
            return error_response(403, "csrf_failed", "Missing or invalid CSRF token.")
        return await call_next(request)


class BodySizeLimitMiddleware:
    """Rejects oversized bodies early (declared length) and while streaming (actual length)."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        declared = headers.get(b"content-length")
        too_large = error_response(413, "payload_too_large", "The request is too large.")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await too_large(scope, receive, send)
            return
        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLargeError
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLargeError:
            if not response_started:
                await too_large(scope, receive, send)


class _BodyTooLargeError(Exception):
    pass
