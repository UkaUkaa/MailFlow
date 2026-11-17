from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from tests.conftest import PASSWORD, ApiClient
from tests.fakes import CapturingNotifier

REG = {"email": "new@example.org", "password": PASSWORD, "display_name": "New User"}


async def _register_and_verify(client: ApiClient, notifier: CapturingNotifier) -> None:
    assert (await client.post("/api/v1/auth/register", json=REG)).status_code == 202
    token = notifier.verifications[REG["email"]]
    assert (
        await client.post("/api/v1/auth/verify-email", json={"token": token})
    ).status_code == 200


async def test_register_verify_login_me_logout(client, notifier):
    await _register_and_verify(client, notifier)
    login = await client.post(
        "/api/v1/auth/login", json={"email": "NEW@example.org", "password": PASSWORD}
    )
    assert login.status_code == 200
    assert "password" not in login.text
    cookie = login.headers.get_list("set-cookie")
    session_cookie = next(c for c in cookie if c.startswith("mf_session="))
    assert "HttpOnly" in session_cookie and "SameSite=lax" in session_cookie
    client.refresh_csrf()
    me = await client.get("/api/v1/auth/me")
    assert me.json()["user"]["email"] == REG["email"]
    assert me.json()["user"]["email_verified"] is True
    assert (await client.post("/api/v1/auth/logout")).status_code == 204
    assert (await client.get("/api/v1/auth/me")).status_code == 401


async def test_password_is_stored_as_argon2id(client, notifier, owner_engine):
    await _register_and_verify(client, notifier)
    async with owner_engine.connect() as conn:
        stored = (await conn.execute(text("SELECT password_hash FROM users"))).scalar_one()
    assert stored.startswith("$argon2id$")
    assert PASSWORD not in stored


async def test_registration_does_not_reveal_existing_accounts(client, notifier, owner_engine):
    await _register_and_verify(client, notifier)
    notifier.verifications.clear()
    again = await client.post(
        "/api/v1/auth/register", json={**REG, "password": "another-password-1"}
    )
    assert again.status_code == 202
    assert again.json() == {"status": "verification_required"}
    assert notifier.verifications == {}
    async with owner_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM users"))).scalar_one() == 1


async def test_login_requires_verified_email(client):
    await client.post("/api/v1/auth/register", json=REG)
    response = await client.post(
        "/api/v1/auth/login", json={"email": REG["email"], "password": PASSWORD}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "email_not_verified"


async def test_login_failures_are_uniform(client, notifier):
    await _register_and_verify(client, notifier)
    wrong = await client.post(
        "/api/v1/auth/login", json={"email": REG["email"], "password": "wrong-password-123"}
    )
    missing = await client.post(
        "/api/v1/auth/login", json={"email": "ghost@example.org", "password": PASSWORD}
    )
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json()


async def test_weak_password_rejected(client):
    response = await client.post("/api/v1/auth/register", json={**REG, "password": "short"})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["code"] == "password_too_short"


async def test_verification_token_is_single_use_and_hashed(client, notifier, owner_engine):
    await client.post("/api/v1/auth/register", json=REG)
    token = notifier.verifications[REG["email"]]
    async with owner_engine.connect() as conn:
        stored = (
            await conn.execute(text("SELECT token_hash FROM email_verification_tokens"))
        ).scalar_one()
    assert stored != token and len(stored) == 64
    assert (
        await client.post("/api/v1/auth/verify-email", json={"token": token})
    ).status_code == 200
    second = await client.post("/api/v1/auth/verify-email", json={"token": token})
    assert second.status_code == 422
    assert second.json()["error"]["code"] == "invalid_token"


async def test_expired_verification_token_rejected(client, notifier, owner_engine):
    await client.post("/api/v1/auth/register", json=REG)
    async with owner_engine.begin() as conn:
        await conn.execute(
            text("UPDATE email_verification_tokens SET expires_at = now() - interval '1 minute'")
        )
    response = await client.post(
        "/api/v1/auth/verify-email", json={"token": notifier.verifications[REG["email"]]}
    )
    assert response.status_code == 422


async def test_csrf_token_required_for_state_changes(client_factory, notifier, alice):
    plain: ApiClient = await client_factory()
    plain.headers.pop("X-CSRF-Token")
    response = await plain.post("/api/v1/auth/login", json={"email": "a@b.co", "password": "x"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"
    # Authenticated session without the header is rejected as well.
    alice.client.headers.pop("X-CSRF-Token")
    response = await alice.client.patch("/api/v1/users/me", json={"display_name": "X"})
    assert response.status_code == 403


async def test_cross_origin_state_change_rejected(alice):
    response = await alice.client.patch(
        "/api/v1/users/me", json={"display_name": "Evil"}, headers={"Origin": "https://evil.test"}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"


async def test_untrusted_host_rejected(client):
    response = await client.get("/api/health/live", headers={"Host": "evil.test"})
    assert response.status_code == 400


async def test_security_headers_present(client):
    response = await client.get("/api/health/live")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "default-src 'none'" in response.headers["content-security-policy"]
    assert response.headers["cache-control"] == "no-store"


async def test_session_listing_and_revocation(actor_factory, client_factory):
    alice = await actor_factory("alice@example.org")
    second: ApiClient = await client_factory()
    login = await second.post(
        "/api/v1/auth/login", json={"email": alice.email, "password": PASSWORD}
    )
    assert login.status_code == 200
    second.refresh_csrf()
    sessions = (await alice.client.get("/api/v1/auth/sessions")).json()["items"]
    assert len(sessions) == 2
    assert sum(1 for s in sessions if s["is_current"]) == 1
    other = next(s for s in sessions if not s["is_current"])
    assert (await alice.client.delete(f"/api/v1/auth/sessions/{other['id']}")).status_code == 204
    assert (await second.get("/api/v1/auth/me")).status_code == 401
    assert (await alice.client.get("/api/v1/auth/me")).status_code == 200


async def test_session_expiry_and_idle_timeout(alice, owner_engine):
    async with owner_engine.begin() as conn:
        await conn.execute(
            text("UPDATE user_sessions SET last_seen_at = :t"),
            {"t": datetime.now(UTC) - timedelta(days=30)},
        )
    assert (await alice.client.get("/api/v1/auth/me")).status_code == 401


async def test_session_token_is_stored_hashed(alice, owner_engine):
    raw = alice.client.cookies.get("mf_session")
    async with owner_engine.connect() as conn:
        stored = (await conn.execute(text("SELECT token_hash FROM user_sessions"))).scalar_one()
    assert raw and raw != stored and len(stored) == 64


async def test_password_reset_flow_revokes_sessions(alice, client_factory, notifier):
    fresh: ApiClient = await client_factory()
    assert (
        await fresh.post("/api/v1/auth/password/forgot", json={"email": alice.email})
    ).status_code == 202
    token = notifier.resets[alice.email]
    reset = await fresh.post(
        "/api/v1/auth/password/reset", json={"token": token, "new_password": "brand new password"}
    )
    assert reset.status_code == 200
    assert (await alice.client.get("/api/v1/auth/me")).status_code == 401
    old = await fresh.post("/api/v1/auth/login", json={"email": alice.email, "password": PASSWORD})
    assert old.status_code == 401
    new = await fresh.post(
        "/api/v1/auth/login", json={"email": alice.email, "password": "brand new password"}
    )
    assert new.status_code == 200
    replay = await fresh.post(
        "/api/v1/auth/password/reset", json={"token": token, "new_password": "third password 123"}
    )
    assert replay.status_code in (403, 422)


async def test_forgot_password_is_silent_for_unknown_email(client, notifier):
    response = await client.post("/api/v1/auth/password/forgot", json={"email": "no@example.org"})
    assert response.status_code == 202
    assert notifier.resets == {}


async def test_change_password_requires_current_and_revokes_others(actor_factory, client_factory):
    alice = await actor_factory("alice@example.org")
    second: ApiClient = await client_factory()
    await second.post("/api/v1/auth/login", json={"email": alice.email, "password": PASSWORD})
    bad = await alice.client.post(
        "/api/v1/auth/password/change",
        json={"current_password": "nope-nope-nope", "new_password": "a new long password"},
    )
    assert bad.status_code == 401
    ok = await alice.client.post(
        "/api/v1/auth/password/change",
        json={"current_password": PASSWORD, "new_password": "a new long password"},
    )
    assert ok.status_code == 204
    assert (await alice.client.get("/api/v1/auth/me")).status_code == 200
    assert (await second.get("/api/v1/auth/me")).status_code == 401


async def test_login_rate_limited_per_identity(client, notifier):
    await _register_and_verify(client, notifier)
    statuses = []
    for _ in range(12):
        response = await client.post(
            "/api/v1/auth/login", json={"email": REG["email"], "password": "wrong-password-123"}
        )
        statuses.append(response.status_code)
    assert statuses[:10] == [401] * 10
    assert statuses[-1] == 429
    assert "retry-after" in response.headers


async def test_profile_and_settings(alice):
    renamed = await alice.client.patch("/api/v1/users/me", json={"display_name": "  Alice   A. "})
    assert renamed.json()["display_name"] == "Alice A."
    defaults = (await alice.client.get("/api/v1/settings")).json()
    assert defaults == {
        "locale": "en",
        "theme": "system",
        "load_remote_images": False,
        "conversation_view": True,
    }
    updated = await alice.client.patch("/api/v1/settings", json={"locale": "uk", "theme": "dark"})
    assert updated.json()["locale"] == "uk" and updated.json()["theme"] == "dark"
    bad = await alice.client.patch("/api/v1/settings", json={"locale": "de"})
    assert bad.status_code == 422


async def test_unauthenticated_requests_are_rejected(client):
    for path in ("/api/v1/accounts", "/api/v1/threads", "/api/v1/settings", "/api/v1/search?q=a"):
        response = await client.get(path)
        assert response.status_code == 401, path
        assert response.json()["error"]["code"] == "unauthenticated"


async def test_readiness(client):
    response = await client.get("/api/health/ready")
    assert response.status_code == 200
    assert response.json()["checks"] == {"database": True, "redis": True}
