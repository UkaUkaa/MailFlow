"""Microsoft identity platform (v2.0) authorization-code flow with PKCE.

Facts below were checked against learn.microsoft.com on 2026-11-17:

- Endpoints ``https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`` and
  ``.../token``; ``{tenant}`` is ``common``, ``organizations``, ``consumers`` or a tenant id.
  https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- A refresh token is issued only when ``offline_access`` is requested, and every refresh
  returns a *new* refresh token that must replace the stored one.
  https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens
- There is no RFC 7009 token revocation endpoint (the endpoint list has only authorize,
  token, userinfo, keys and logout). ``POST /me/revokeSignInSessions`` invalidates the user's
  refresh tokens for *every* application, needs an extra admin-level permission and is not
  supported for personal accounts, so it is deliberately not used.
  https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc
  https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import quote, urlencode

import httpx

from app.integrations.email_providers.contracts.errors import (
    ProviderAuthError,
    ProviderError,
    ProviderUnavailable,
)
from app.integrations.email_providers.contracts.models import Credentials, OAuthIdentity

LOGIN_HOST = "https://login.microsoftonline.com"
GRAPH_SCOPE_PREFIX = "https://graph.microsoft.com/"
PROFILE_URL = "https://graph.microsoft.com/v1.0/me"
# Narrowest delegated scopes that cover the contract (permissions reference, 2026-11-17; none
# of them needs admin consent and all are available to personal Microsoft accounts):
#   Mail.ReadWrite - read, flag, move, drafts, attachments (least privilege for move/update)
#   Mail.Send      - send a draft (least privilege for message: send)
#   User.Read      - GET /me for the mailbox address (least privilege for that call)
#   offline_access - refresh token for background synchronization
MAIL_SCOPES = ("Mail.ReadWrite", "Mail.Send")
SCOPES = (
    "offline_access",
    *(f"{GRAPH_SCOPE_PREFIX}{name}" for name in (*MAIL_SCOPES, "User.Read")),
)
# Token endpoint error codes that mean "the user must sign in again". Anything else (for
# example ``invalid_client`` after the application secret expired) is an operator problem
# and must not push every connected mailbox into ``needs_reauth``.
_REAUTH_ERRORS = frozenset({"invalid_grant", "interaction_required", "consent_required"})


def authorize_url(tenant: str) -> str:
    return f"{LOGIN_HOST}/{quote(tenant, safe='')}/oauth2/v2.0/authorize"


def token_url(tenant: str) -> str:
    return f"{LOGIN_HOST}/{quote(tenant, safe='')}/oauth2/v2.0/token"


def _granted(scope: str) -> set[str]:
    """Scope names as granted, without the resource prefix and case-insensitively."""
    return {part.removeprefix(GRAPH_SCOPE_PREFIX).lower() for part in scope.split()}


class MicrosoftOAuthClient:
    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        tenant: str = "common",
    ) -> None:
        self._client = client
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._tenant = tenant or "common"

    def authorization_url(
        self, *, state: str, code_challenge: str, login_hint: str | None = None
    ) -> str:
        params = {
            "client_id": self._client_id,
            "response_type": "code",
            "redirect_uri": self._redirect_uri,  # fixed server-side value, never user input
            "response_mode": "query",
            "scope": " ".join(SCOPES),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        if login_hint:
            params["login_hint"] = login_hint  # reconnect: steer to the same mailbox
        else:
            # Let the person pick which Microsoft account to connect instead of silently
            # reusing whichever one the browser is signed in to.
            params["prompt"] = "select_account"
        return f"{authorize_url(self._tenant)}?{urlencode(params)}"

    async def _token_request(self, data: dict[str, str]) -> dict[str, object]:
        try:
            response = await self._client.post(
                token_url(self._tenant),
                data={"client_id": self._client_id, "client_secret": self._client_secret, **data},
            )
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(type(exc).__name__) from exc
        if response.status_code >= 500:
            raise ProviderUnavailable(f"token endpoint error ({response.status_code})")
        if response.status_code >= 400:
            # Only the machine-readable code is read; the description is never logged.
            try:
                code = str(response.json().get("error", ""))
            except (ValueError, AttributeError):
                code = ""
            if code in _REAUTH_ERRORS:
                raise ProviderAuthError("authorization grant rejected")
            if code == "temporarily_unavailable":
                raise ProviderUnavailable("token endpoint temporarily unavailable")
            raise ProviderError(f"token endpoint rejected request ({response.status_code})")
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderUnavailable("token endpoint returned no JSON") from exc
        if not isinstance(payload, dict):
            raise ProviderUnavailable("token endpoint returned unexpected JSON")
        return payload

    @staticmethod
    def _credentials(payload: dict[str, object], previous: Credentials | None) -> Credentials:
        access_token = payload.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise ProviderAuthError("token response without access token")
        expires_in = payload.get("expires_in")
        try:
            seconds = int(expires_in) if isinstance(expires_in, int | float | str) else 3600
        except ValueError:
            seconds = 3600
        rotated = payload.get("refresh_token")
        scope = payload.get("scope")
        return Credentials(
            access_token=access_token,
            # Microsoft rotates the refresh token on every use; keep the old one only when
            # the response carries none.
            refresh_token=(
                rotated
                if isinstance(rotated, str) and rotated
                else (previous.refresh_token if previous else None)
            ),
            expires_at=datetime.now(UTC) + timedelta(seconds=seconds),
            scope=scope
            if isinstance(scope, str) and scope
            else (previous.scope if previous else ""),
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
        # ``scope`` is optional in the token response; when present it must cover mail access.
        if credentials.scope and not {s.lower() for s in MAIL_SCOPES} <= _granted(
            credentials.scope
        ):
            raise ProviderAuthError("required scope was not granted")
        return credentials

    async def refresh_credentials(self, credentials: Credentials) -> Credentials:
        if not credentials.refresh_token:
            raise ProviderAuthError("missing refresh token")
        payload = await self._token_request(
            {"grant_type": "refresh_token", "refresh_token": credentials.refresh_token}
        )
        return self._credentials(payload, credentials)

    async def revoke_credentials(self, credentials: Credentials) -> None:
        """Documented no-op: the Microsoft identity platform has no token revocation endpoint.

        MailFlow still deletes its stored tokens on disconnect; the grant itself stays listed
        under the user's Microsoft account until they remove it there (see docs/LIMITATIONS.md).
        """
        return None

    async def fetch_identity(self, credentials: Credentials) -> OAuthIdentity:
        try:
            response = await self._client.get(
                PROFILE_URL,
                params={"$select": "id,mail,userPrincipalName"},
                headers={"Authorization": f"Bearer {credentials.access_token}"},
            )
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(type(exc).__name__) from exc
        if response.status_code in (401, 403):
            raise ProviderAuthError("profile request rejected")
        if response.status_code >= 400:
            raise ProviderUnavailable(f"profile request failed ({response.status_code})")
        try:
            profile = response.json()
        except ValueError as exc:
            raise ProviderUnavailable("profile response was not JSON") from exc
        # ``mail`` is the SMTP address but can be null (for example personal accounts);
        # ``userPrincipalName`` is then the sign-in address.
        email = str(profile.get("mail") or profile.get("userPrincipalName") or "").strip().lower()
        subject = str(profile.get("id") or email)
        if "@" not in email or "#" in email or len(email) > 320:
            raise ProviderError("profile without a usable email address")
        return OAuthIdentity(subject=subject, email=email)
