"""Google OAuth 2.0 authorization-code flow with PKCE."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx

from app.integrations.email_providers.contracts.errors import (
    ProviderAuthError,
    ProviderError,
    ProviderUnavailable,
)
from app.integrations.email_providers.contracts.models import Credentials, OAuthIdentity

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
# Narrowest practical scope: read, label, trash, send and drafts. No permanent delete,
# no settings access. The mailbox address comes from the Gmail profile, so no OpenID scopes.
SCOPES = ("https://www.googleapis.com/auth/gmail.modify",)


class GoogleOAuthClient:
    def __init__(
        self, client: httpx.AsyncClient, *, client_id: str, client_secret: str, redirect_uri: str
    ) -> None:
        self._client = client
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri

    def authorization_url(
        self, *, state: str, code_challenge: str, login_hint: str | None = None
    ) -> str:
        params = {
            "client_id": self._client_id,
            "redirect_uri": self._redirect_uri,  # fixed server-side value, never user input
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "access_type": "offline",  # refresh token for background synchronization
            "prompt": "consent",  # guarantees a refresh token on reconnect
            "include_granted_scopes": "false",
        }
        if login_hint:
            params["login_hint"] = login_hint
        return f"{AUTH_URL}?{urlencode(params)}"

    async def _token_request(self, data: dict[str, str]) -> dict[str, object]:
        try:
            response = await self._client.post(
                TOKEN_URL,
                data={"client_id": self._client_id, "client_secret": self._client_secret, **data},
            )
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(type(exc).__name__) from exc
        if response.status_code in (400, 401):
            # invalid_grant: revoked, expired or already used. Body is not logged.
            raise ProviderAuthError("authorization grant rejected")
        if response.status_code >= 500:
            raise ProviderUnavailable(f"token endpoint error ({response.status_code})")
        if response.status_code >= 400:
            raise ProviderError(f"token endpoint rejected request ({response.status_code})")
        payload: dict[str, object] = response.json()
        return payload

    @staticmethod
    def _credentials(payload: dict[str, object], refresh_token: str | None) -> Credentials:
        access_token = payload.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise ProviderAuthError("token response without access token")
        expires_in = payload.get("expires_in")
        seconds = int(expires_in) if isinstance(expires_in, int | float | str) else 3600
        new_refresh = payload.get("refresh_token")
        return Credentials(
            access_token=access_token,
            refresh_token=new_refresh if isinstance(new_refresh, str) else refresh_token,
            expires_at=datetime.now(UTC) + timedelta(seconds=seconds),
            scope=str(payload.get("scope", "")),
        )

    async def authenticate(self, *, code: str, code_verifier: str) -> Credentials:
        payload = await self._token_request(
            {
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": code_verifier,
                "redirect_uri": self._redirect_uri,
            }
        )
        credentials = self._credentials(payload, None)
        if not credentials.refresh_token:
            raise ProviderAuthError("no refresh token granted")
        if not set(SCOPES) <= set(credentials.scope.split()):
            raise ProviderAuthError("required scope was not granted")
        return credentials

    async def refresh_credentials(self, credentials: Credentials) -> Credentials:
        if not credentials.refresh_token:
            raise ProviderAuthError("missing refresh token")
        payload = await self._token_request(
            {"grant_type": "refresh_token", "refresh_token": credentials.refresh_token}
        )
        return self._credentials(payload, credentials.refresh_token)

    async def revoke_credentials(self, credentials: Credentials) -> None:
        token = credentials.refresh_token or credentials.access_token
        try:
            # Token in the form body, not the query string, so it cannot end up in URL logs.
            await self._client.post(REVOKE_URL, data={"token": token})
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(type(exc).__name__) from exc

    async def fetch_identity(self, credentials: Credentials) -> OAuthIdentity:
        try:
            response = await self._client.get(
                PROFILE_URL, headers={"Authorization": f"Bearer {credentials.access_token}"}
            )
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(type(exc).__name__) from exc
        if response.status_code in (401, 403):
            raise ProviderAuthError("profile request rejected")
        if response.status_code >= 400:
            raise ProviderUnavailable(f"profile request failed ({response.status_code})")
        email = str(response.json().get("emailAddress", "")).lower()
        if not email:
            raise ProviderError("profile without email address")
        return OAuthIdentity(subject=email, email=email)
