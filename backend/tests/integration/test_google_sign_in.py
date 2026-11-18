"""Sign in to MailFlow with Google (OIDC). The provider is faked at the HTTP boundary."""

from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import text

from app.modules.authentication.domain.entities import (
    ExternalIdentity,
    ExternalSignInError,
    SignInProviderKind,
)
from app.modules.authentication.presentation.dependencies import get_google_sign_in
from tests.conftest import PASSWORD, ApiClient
from tests.fakes import CapturingNotifier

START = "/api/v1/auth/oauth/google/start"
CALLBACK = "/api/v1/auth/oauth/google/callback"


@dataclass
class FakeGoogle:
    kind = SignInProviderKind.GOOGLE
    configured: bool = True
    identity: ExternalIdentity | None = None
    nonces: list[str] = field(default_factory=list)
    fail: bool = False

    def authorization_url(self, *, state: str, code_challenge: str, nonce: str) -> str:
        self.nonces.append(nonce)
        return f"https://accounts.example/auth?state={state}&code_challenge={code_challenge}"

    async def exchange(self, *, code: str, code_verifier: str, nonce: str) -> ExternalIdentity:
        assert code == "good-code"
        assert nonce == self.nonces[-1]
        assert len(code_verifier) >= 43
        if self.fail or self.identity is None:
            raise ExternalSignInError("rejected")
        return self.identity


def identity(email: str = "gina@example.org", *, sub: str = "g-123", verified: bool = True):
    return ExternalIdentity(
        provider=SignInProviderKind.GOOGLE,
        subject=sub,
        email=email,
        email_verified=verified,
        display_name="Gina Google",
    )


@pytest.fixture
def google(app) -> FakeGoogle:  # type: ignore[no-untyped-def]
    fake = FakeGoogle(identity=identity())
    app.dependency_overrides[get_google_sign_in] = lambda: fake
    return fake


async def _start(client: ApiClient, **params: str) -> str:
    response = await client.get(START, params={"locale": "uk", **params})
    assert response.status_code == 302
    assert response.headers["location"].startswith("https://accounts.example/auth")
    cookie = next(c for c in response.headers.get_list("set-cookie") if "mf_signin_state=" in c)
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie
    return parse_qs(urlsplit(response.headers["location"]).query)["state"][0]


async def _sign_in(client: ApiClient, **params: str):  # type: ignore[no-untyped-def]
    state = await _start(client, **params)
    return await client.get(CALLBACK, params={"code": "good-code", "state": state})


async def _user_count(owner_engine) -> int:  # type: ignore[no-untyped-def]
    async with owner_engine.connect() as conn:
        return int((await conn.execute(text("SELECT count(*) FROM users"))).scalar_one())


async def test_providers_reports_configuration(client, google):
    assert (await client.get("/api/v1/auth/providers")).json() == {"google": True}
    google.configured = False
    assert (await client.get("/api/v1/auth/providers")).json() == {"google": False}
    response = await client.get(START, params={"locale": "uk"})
    assert response.status_code == 302
    assert response.headers["location"].endswith("/uk/login?oauth_error=not_configured")


async def test_first_sign_in_creates_verified_user_and_session(client, google, owner_engine):
    response = await _sign_in(client)
    assert response.status_code == 302
    assert response.headers["location"].endswith("/uk/mail/inbox")
    assert any(c.startswith("mf_session=") for c in response.headers.get_list("set-cookie"))
    client.refresh_csrf()
    me = (await client.get("/api/v1/auth/me")).json()["user"]
    assert me["email"] == "gina@example.org"
    assert me["email_verified"] is True
    assert me["display_name"] == "Gina Google"
    async with owner_engine.connect() as conn:
        stored = (await conn.execute(text("SELECT password_hash FROM users"))).scalar_one()
    assert stored.startswith("$argon2id$")  # unusable random password, never empty


async def test_second_sign_in_reuses_the_linked_user(client_factory, google, owner_engine):
    first = await client_factory()
    await _sign_in(first)
    # The Google address changed, but the stable subject still identifies the same user.
    google.identity = identity("renamed@example.org")
    second = await client_factory()
    response = await _sign_in(second)
    second.refresh_csrf()
    assert response.status_code == 302
    assert (await second.get("/api/v1/auth/me")).json()["user"]["email"] == "gina@example.org"
    assert await _user_count(owner_engine) == 1


async def test_links_existing_verified_password_account(alice, client_factory, google):
    google.identity = identity(alice.email.upper(), sub="alice-sub")
    browser = await client_factory()
    await _sign_in(browser)
    browser.refresh_csrf()
    me = (await browser.get("/api/v1/auth/me")).json()["user"]
    assert me["id"] == str(alice.user_id)
    # The password keeps working for an account whose address was already proven.
    password_client = await client_factory()
    login = await password_client.post(
        "/api/v1/auth/login", json={"email": alice.email, "password": PASSWORD}
    )
    assert login.status_code == 200


async def test_unverified_preregistration_cannot_take_over(
    client_factory, google, notifier: CapturingNotifier
):
    attacker = await client_factory()
    reg = {"email": "victim@example.org", "password": PASSWORD, "display_name": "Mallory"}
    assert (await attacker.post("/api/v1/auth/register", json=reg)).status_code == 202

    google.identity = identity("victim@example.org", sub="victim-sub")
    victim = await client_factory()
    assert (await _sign_in(victim)).status_code == 302

    # The attacker's never-verified password no longer opens the account.
    login = await attacker.post(
        "/api/v1/auth/login", json={"email": reg["email"], "password": PASSWORD}
    )
    assert login.status_code == 401


async def test_state_must_match_the_browser_that_started(client_factory, google, owner_engine):
    attacker = await client_factory()
    state = await _start(attacker)
    victim = await client_factory()
    response = await victim.get(CALLBACK, params={"code": "good-code", "state": state})
    assert response.headers["location"].endswith("/en/login?oauth_error=invalid_state")
    assert not any(c.startswith("mf_session=") for c in response.headers.get_list("set-cookie"))
    assert await _user_count(owner_engine) == 0


async def test_state_is_single_use(client, google):
    state = await _start(client)
    assert (
        (await client.get(CALLBACK, params={"code": "good-code", "state": state}))
        .headers["location"]
        .endswith("/uk/mail/inbox")
    )
    client.cookies.set("mf_signin_state", state, path="/api/v1/auth/oauth/")
    again = await client.get(CALLBACK, params={"code": "good-code", "state": state})
    assert again.headers["location"].endswith("/en/login?oauth_error=invalid_state")


@pytest.mark.parametrize(
    ("setup", "params", "expected"),
    [
        ("unverified", {"code": "good-code"}, "email_not_verified"),
        ("fail", {"code": "good-code"}, "provider_error"),
        (None, {"error": "access_denied"}, "access_denied"),
    ],
)
async def test_failures_return_to_login(client, google, owner_engine, setup, params, expected):
    if setup == "unverified":
        google.identity = identity(verified=False)
    elif setup == "fail":
        google.fail = True
    state = await _start(client)
    response = await client.get(CALLBACK, params={**params, "state": state})
    assert response.headers["location"].endswith(f"/uk/login?oauth_error={expected}")
    assert await _user_count(owner_engine) == 0


@pytest.mark.parametrize(
    ("next_path", "expected"),
    [
        ("/settings/accounts", "/uk/settings/accounts"),
        ("//evil.example/x", "/uk/mail/inbox"),
        ("https://evil.example", "/uk/mail/inbox"),
        ("/\\evil.example", "/uk/mail/inbox"),
    ],
)
async def test_return_path_is_same_origin_only(client, google, settings, next_path, expected):
    response = await _sign_in(client, next=next_path)
    assert response.headers["location"] == f"{settings.app_base_url}{expected}"


async def test_deactivated_user_cannot_sign_in(client_factory, google, owner_engine):
    first = await client_factory()
    await _sign_in(first)
    async with owner_engine.begin() as conn:
        await conn.execute(text("UPDATE users SET status = 'deactivated'"))
    second = await client_factory()
    response = await _sign_in(second)
    assert response.headers["location"].endswith("/uk/login?oauth_error=account_disabled")
