"""Google OpenID Connect client for signing in to MailFlow.

Scopes are ``openid email profile`` only: this proves who the user is and grants no access to
their mailbox. Gmail access is a separate grant made by the ``email_accounts`` module.
"""

from __future__ import annotations

import base64
import json
import secrets
import time
from urllib.parse import urlencode

import httpx

from app.modules.authentication.domain.entities import (
    ExternalIdentity,
    ExternalSignInError,
    SignInProviderKind,
)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = frozenset({"https://accounts.google.com", "accounts.google.com"})
SCOPES = ("openid", "email", "profile")
CLOCK_SKEW_SECONDS = 60


def _decode_segment(segment: str) -> dict[str, object]:
    padded = segment + "=" * (-len(segment) % 4)
    value = json.loads(base64.urlsafe_b64decode(padded))
    if not isinstance(value, dict):
        raise ValueError("not an object")
    return value


class GoogleSignInClient:
    kind = SignInProviderKind.GOOGLE

    def __init__(
        self, client: httpx.AsyncClient, *, client_id: str, client_secret: str, redirect_uri: str
    ) -> None:
        self._client = client
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri

    @property
    def configured(self) -> bool:
        return bool(self._client_id and self._client_secret)

    def authorization_url(self, *, state: str, code_challenge: str, nonce: str) -> str:
        params = {
            "client_id": self._client_id,
            "redirect_uri": self._redirect_uri,  # fixed server-side value, never user input
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "access_type": "online",  # no refresh token: nothing is stored after sign-in
            "prompt": "select_account",
        }
        return f"{AUTH_URL}?{urlencode(params)}"

    async def exchange(self, *, code: str, code_verifier: str, nonce: str) -> ExternalIdentity:
        try:
            response = await self._client.post(
                TOKEN_URL,
                data={
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "code": code,
                    "code_verifier": code_verifier,
                    "grant_type": "authorization_code",
                    "redirect_uri": self._redirect_uri,
                },
            )
        except httpx.HTTPError as exc:
            raise ExternalSignInError("token endpoint unreachable") from exc
        if response.status_code != 200:
            raise ExternalSignInError(f"token endpoint returned {response.status_code}")
        id_token = response.json().get("id_token")
        if not isinstance(id_token, str):
            raise ExternalSignInError("no id_token in response")
        return self._identity(self._claims(id_token, nonce))

    def _claims(self, id_token: str, nonce: str) -> dict[str, object]:
        """Validate the ID token claims.

        The token comes straight from Google's token endpoint over verified TLS in exchange
        for our client secret and PKCE verifier, so per OpenID Connect Core 3.1.3.7 (6) the
        TLS server identity stands in for the signature check. Issuer, audience, expiry and
        nonce are still verified.
        """
        parts = id_token.split(".")
        if len(parts) != 3:
            raise ExternalSignInError("malformed id_token")
        try:
            claims = _decode_segment(parts[1])
        except (ValueError, json.JSONDecodeError) as exc:
            raise ExternalSignInError("malformed id_token") from exc
        now = time.time()
        aud = claims.get("aud")
        audiences = aud if isinstance(aud, list) else [aud]
        exp = claims.get("exp")
        token_nonce = claims.get("nonce")
        if claims.get("iss") not in ISSUERS:
            raise ExternalSignInError("unexpected issuer")
        if self._client_id not in audiences:
            raise ExternalSignInError("unexpected audience")
        if not isinstance(exp, int | float) or exp + CLOCK_SKEW_SECONDS < now:
            raise ExternalSignInError("id_token expired")
        if not isinstance(token_nonce, str) or not secrets.compare_digest(token_nonce, nonce):
            raise ExternalSignInError("nonce mismatch")
        return claims

    def _identity(self, claims: dict[str, object]) -> ExternalIdentity:
        subject = claims.get("sub")
        email = claims.get("email")
        if not isinstance(subject, str) or not subject or not isinstance(email, str) or not email:
            raise ExternalSignInError("id_token lacks sub or email")
        verified = claims.get("email_verified")
        name = claims.get("name")
        return ExternalIdentity(
            provider=self.kind,
            subject=subject,
            email=email,
            email_verified=verified is True or verified == "true",
            display_name=name if isinstance(name, str) else "",
        )
