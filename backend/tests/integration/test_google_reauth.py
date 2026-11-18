"""Confirming account deletion / deactivation with a fresh Google sign-in instead of a password.

Users who signed up with Google never chose a password, so this is how they confirm.
"""

from __future__ import annotations

import dataclasses
import time
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import text

from app.modules.authentication.presentation.dependencies import get_google_sign_in
from tests.conftest import PASSWORD, ApiClient
from tests.integration.test_google_sign_in import FakeGoogle, _sign_in, identity

REAUTH = "/api/v1/auth/oauth/google/reauth"
CALLBACK = "/api/v1/auth/oauth/google/callback"


@pytest.fixture
def google(app) -> FakeGoogle:  # type: ignore[no-untyped-def]
    fake = FakeGoogle(identity=identity())
    app.dependency_overrides[get_google_sign_in] = lambda: fake
    return fake


async def _google_user(client_factory) -> ApiClient:  # type: ignore[no-untyped-def]
    client: ApiClient = await client_factory()
    assert (await _sign_in(client)).status_code == 302
    client.refresh_csrf()
    return client


async def _reauth(client: ApiClient, purpose: str = "delete"):  # type: ignore[no-untyped-def]
    started = await client.post(REAUTH, json={"purpose": purpose, "locale": "uk"})
    assert started.status_code == 200, started.text
    url = started.json()["authorization_url"]
    state = parse_qs(urlsplit(url).query)["state"][0]
    return await client.get(CALLBACK, params={"code": "good-code", "state": state})


def _query(response) -> dict[str, list[str]]:  # type: ignore[no-untyped-def]
    location = response.headers["location"]
    assert urlsplit(location).path == "/uk/settings/danger"
    return parse_qs(urlsplit(location).query)


async def _users(owner_engine) -> int:  # type: ignore[no-untyped-def]
    async with owner_engine.connect() as conn:
        return int((await conn.execute(text("SELECT count(*) FROM users"))).scalar_one())


async def test_google_user_deletes_account_after_fresh_google_sign_in(
    client_factory, google: FakeGoogle, owner_engine
):
    client = await _google_user(client_factory)
    assert (await client.get("/api/v1/auth/reauth/methods")).json() == {"google": True}

    # Without a password and without re-confirming, deletion is refused.
    refused = await client.request("DELETE", "/api/v1/users/me", json={"confirmation": "DELETE"})
    assert refused.status_code == 401

    response = await _reauth(client)
    assert google.reauthenticate[-1] is True  # Google is asked to prompt for login again
    assert response.status_code == 302
    assert _query(response) == {"reauth": ["delete"]}
    cookie = next(c for c in response.headers.get_list("set-cookie") if "mf_reauth=" in c)
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie
    assert "Path=/api/v1/users/me" in cookie

    deleted = await client.request("DELETE", "/api/v1/users/me", json={"confirmation": "DELETE"})
    assert deleted.status_code == 204
    assert await _users(owner_engine) == 0


async def test_google_user_deactivates_account(client_factory, google, owner_engine):
    client = await _google_user(client_factory)
    await _reauth(client, "deactivate")
    response = await client.post("/api/v1/users/me/deactivate", json={})
    assert response.status_code == 204
    async with owner_engine.connect() as conn:
        status = (await conn.execute(text("SELECT status FROM users"))).scalar_one()
    assert status == "deactivated"


async def test_grant_is_single_use_and_bound_to_its_purpose(client_factory, google, owner_engine):
    client = await _google_user(client_factory)
    await _reauth(client, "deactivate")
    # A grant for deactivation does not delete the account, and is burned by the attempt.
    wrong = await client.request("DELETE", "/api/v1/users/me", json={"confirmation": "DELETE"})
    assert wrong.status_code == 401
    again = await client.post("/api/v1/users/me/deactivate", json={})
    assert again.status_code == 401
    assert await _users(owner_engine) == 1


async def test_a_different_google_account_cannot_confirm(client_factory, google, owner_engine):
    client = await _google_user(client_factory)
    google.identity = identity("mallory@example.org", sub="other-sub")
    response = await _reauth(client)
    assert _query(response) == {"reauth": ["delete"], "reauth_error": ["reauth_mismatch"]}
    assert not any("mf_reauth=" in c for c in response.headers.get_list("set-cookie"))
    refused = await client.request("DELETE", "/api/v1/users/me", json={"confirmation": "DELETE"})
    assert refused.status_code == 401
    assert await _users(owner_engine) == 1


async def test_stale_google_sign_in_is_rejected(client_factory, google, owner_engine):
    client = await _google_user(client_factory)
    assert google.identity is not None
    google.identity = dataclasses.replace(google.identity, authenticated_at=time.time() - 3600)
    response = await _reauth(client)
    assert _query(response)["reauth_error"] == ["reauth_stale"]


async def test_grant_of_one_user_does_not_work_for_another(
    alice, client_factory, google, owner_engine
):
    client = await _google_user(client_factory)
    await _reauth(client)
    grant = client.cookies.get("mf_reauth", path="/api/v1/users/me")
    assert grant
    alice.client.cookies.set("mf_reauth", grant, path="/api/v1/users/me")
    refused = await alice.client.request(
        "DELETE", "/api/v1/users/me", json={"confirmation": "DELETE"}
    )
    assert refused.status_code == 401
    assert await _users(owner_engine) == 2


async def test_password_user_without_google_keeps_password_confirmation(alice, google):
    assert (await alice.client.get("/api/v1/auth/reauth/methods")).json() == {"google": False}
    started = await alice.client.post(REAUTH, json={"purpose": "delete"})
    assert started.status_code == 422
    deleted = await alice.client.request(
        "DELETE", "/api/v1/users/me", json={"password": PASSWORD, "confirmation": "DELETE"}
    )
    assert deleted.status_code == 204


async def test_reauth_requires_a_session(client, google):
    assert (await client.post(REAUTH, json={"purpose": "delete"})).status_code == 401
    assert (await client.get("/api/v1/auth/reauth/methods")).status_code == 401
