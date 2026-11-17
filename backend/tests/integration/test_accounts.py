from __future__ import annotations

import base64
import hashlib
import uuid

from sqlalchemy import text

from app.integrations.email_providers.contracts import ProviderKind
from tests.conftest import connect_mailbox


async def test_connect_flow_stores_encrypted_credentials_and_queues_sync(
    alice, registry, queue, owner_engine
):
    account_id = await connect_mailbox(alice, registry, "alice.mail@example.org")
    accounts = (await alice.client.get("/api/v1/accounts")).json()["items"]
    assert [a["id"] for a in accounts] == [str(account_id)]
    assert accounts[0]["status"] == "active"
    assert accounts[0]["capabilities"]["threads"] is True
    assert queue.items == [(alice.user_id, account_id)]
    # PKCE: the verifier sent to the token endpoint matches the challenge in the consent URL.
    digest = hashlib.sha256(registry.last_verifier.encode()).digest()
    assert base64.urlsafe_b64encode(digest).decode().rstrip("=") == registry.last_challenge
    async with owner_engine.connect() as conn:
        row = (
            await conn.execute(text("SELECT ciphertext, key_id, nonce FROM account_credentials"))
        ).one()
    assert b"at:alice.mail" not in row.ciphertext and b"rt:" not in row.ciphertext
    assert len(row.nonce) == 12 and row.key_id


async def test_credentials_never_appear_in_api_responses(alice, registry):
    await connect_mailbox(alice, registry, "alice.mail@example.org")
    for path in ("/api/v1/accounts", "/api/v1/sync/status", "/api/v1/accounts/providers"):
        body = (await alice.client.get(path)).text
        assert "at:" not in body and "rt:" not in body and "token" not in body.lower()


async def test_callback_rejects_unknown_and_replayed_state(alice, registry):
    registry.codes["c1"] = "x@example.org"
    bad = await alice.client.get(
        "/api/v1/accounts/oauth/gmail/callback", params={"code": "c1", "state": "forged-state"}
    )
    assert bad.status_code == 302 and "error=invalid_state" in bad.headers["location"]
    start = await alice.client.post("/api/v1/accounts/oauth/gmail/start", json={"locale": "uk"})
    state = start.json()["authorization_url"].split("state=")[1].split("&")[0]
    first = await alice.client.get(
        "/api/v1/accounts/oauth/gmail/callback", params={"code": "c1", "state": state}
    )
    assert "/uk/settings/accounts?connected=" in first.headers["location"]
    replay = await alice.client.get(
        "/api/v1/accounts/oauth/gmail/callback", params={"code": "c1", "state": state}
    )
    assert "error=invalid_state" in replay.headers["location"]
    assert len((await alice.client.get("/api/v1/accounts")).json()["items"]) == 1


async def test_state_issued_to_one_user_cannot_be_used_by_another(alice, bob, registry):
    start = await alice.client.post("/api/v1/accounts/oauth/gmail/start", json={})
    state = start.json()["authorization_url"].split("state=")[1].split("&")[0]
    registry.codes["c2"] = "victim@example.org"
    response = await bob.client.get(
        "/api/v1/accounts/oauth/gmail/callback", params={"code": "c2", "state": state}
    )
    assert "error=invalid_state" in response.headers["location"]
    assert (await bob.client.get("/api/v1/accounts")).json()["items"] == []


async def test_callback_requires_session_and_redirects_only_to_app(client, alice, registry):
    anonymous = await client.get(
        "/api/v1/accounts/oauth/gmail/callback", params={"code": "c", "state": "s"}
    )
    assert anonymous.status_code == 401
    denied = await alice.client.get(
        "/api/v1/accounts/oauth/gmail/callback",
        params={"error": "access_denied", "state": "x", "redirect": "https://evil.test"},
    )
    assert denied.headers["location"].startswith("http://test/")


async def test_provider_denial_and_bad_code(alice, registry):
    start = await alice.client.post("/api/v1/accounts/oauth/gmail/start", json={})
    state = start.json()["authorization_url"].split("state=")[1].split("&")[0]
    response = await alice.client.get(
        "/api/v1/accounts/oauth/gmail/callback", params={"code": "unknown", "state": state}
    )
    assert "error=authorization_failed" in response.headers["location"]


async def test_provider_not_configured(alice, registry):
    registry.available = False
    response = await alice.client.post("/api/v1/accounts/oauth/gmail/start", json={})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_not_configured"
    providers = (await alice.client.get("/api/v1/accounts/providers")).json()["items"]
    assert all(p["available"] is False for p in providers)


async def test_unconfigured_and_unimplemented_providers_are_not_offered(alice):
    providers = {
        p["kind"]: p for p in (await alice.client.get("/api/v1/accounts/providers")).json()["items"]
    }
    assert providers["gmail"]["available"] is True
    assert providers["outlook"]["available"] is False
    assert providers["imap"]["available"] is False
    # Outlook is implemented but not configured on this server: a clear 503, no consent URL.
    outlook = await alice.client.post("/api/v1/accounts/oauth/outlook/start", json={})
    assert outlook.status_code == 503
    assert outlook.json()["error"]["code"] == "provider_not_configured"
    # IMAP has no OAuth flow at all.
    assert (
        await alice.client.post("/api/v1/accounts/oauth/imap/start", json={})
    ).status_code == 404


async def test_outlook_connect_flow_and_reconnect(alice, registry, queue):
    registry.available_kinds.add(ProviderKind.OUTLOOK)
    providers = {
        p["kind"]: p for p in (await alice.client.get("/api/v1/accounts/providers")).json()["items"]
    }
    assert providers["outlook"]["available"] is True
    account_id = await connect_mailbox(alice, registry, "alice@outlook.example", "outlook")
    accounts = (await alice.client.get("/api/v1/accounts")).json()["items"]
    assert [(a["id"], a["provider"], a["status"]) for a in accounts] == [
        (str(account_id), "outlook", "active")
    ]
    assert queue.items == [(alice.user_id, account_id)]
    # The same address on another provider is a different mailbox, not a reconnect.
    gmail_id = await connect_mailbox(alice, registry, "alice@outlook.example")
    assert gmail_id != account_id
    # A state issued for Outlook cannot be redeemed on the Gmail callback.
    start = await alice.client.post("/api/v1/accounts/oauth/outlook/start", json={})
    state = start.json()["authorization_url"].split("state=")[1].split("&")[0]
    registry.codes["cx"] = "other@outlook.example"
    crossed = await alice.client.get(
        "/api/v1/accounts/oauth/gmail/callback", params={"code": "cx", "state": state}
    )
    assert "error=invalid_state" in crossed.headers["location"]
    # Reconnect goes through the account's own provider and must return the same mailbox.
    restart = await alice.client.post(f"/api/v1/accounts/{account_id}/reconnect", json={})
    state = restart.json()["authorization_url"].split("state=")[1].split("&")[0]
    registry.codes["again"] = "alice@outlook.example"
    done = await alice.client.get(
        "/api/v1/accounts/oauth/outlook/callback", params={"code": "again", "state": state}
    )
    assert f"connected={account_id}" in done.headers["location"]


async def test_long_authorization_codes_are_accepted(alice, registry):
    # Microsoft work-account codes are far longer than Google's.
    registry.available_kinds.add(ProviderKind.OUTLOOK)
    start = await alice.client.post("/api/v1/accounts/oauth/outlook/start", json={})
    state = start.json()["authorization_url"].split("state=")[1].split("&")[0]
    code = "0." + "A" * 3000
    registry.codes[code] = "long@outlook.example"
    done = await alice.client.get(
        "/api/v1/accounts/oauth/outlook/callback", params={"code": code, "state": state}
    )
    assert "connected=" in done.headers["location"]


async def test_multiple_accounts_and_duplicate_connect(alice, registry):
    first = await connect_mailbox(alice, registry, "one@example.org")
    second = await connect_mailbox(alice, registry, "two@example.org")
    again = await connect_mailbox(alice, registry, "one@example.org")
    assert again == first and first != second
    accounts = (await alice.client.get("/api/v1/accounts")).json()["items"]
    assert len(accounts) == 2
    assert accounts[0]["color"] != accounts[1]["color"]


async def test_reconnect_requires_same_mailbox(alice, registry, runtime):
    account_id = await connect_mailbox(alice, registry, "one@example.org")
    start = await alice.client.post(f"/api/v1/accounts/{account_id}/reconnect", json={})
    state = start.json()["authorization_url"].split("state=")[1].split("&")[0]
    registry.codes["other"] = "different@example.org"
    response = await alice.client.get(
        "/api/v1/accounts/oauth/gmail/callback", params={"code": "other", "state": state}
    )
    assert "error=account_mismatch" in response.headers["location"]
    assert registry.revoked == ["rt:different@example.org"]


async def test_update_and_disconnect_account(alice, registry, owner_engine):
    account_id = await connect_mailbox(alice, registry, "one@example.org")
    updated = await alice.client.patch(
        f"/api/v1/accounts/{account_id}", json={"display_name": "Work", "color": "green"}
    )
    assert updated.json()["display_name"] == "Work" and updated.json()["color"] == "green"
    bad = await alice.client.patch(f"/api/v1/accounts/{account_id}", json={"color": "neon"})
    assert bad.status_code == 422
    assert (await alice.client.delete(f"/api/v1/accounts/{account_id}")).status_code == 204
    assert registry.revoked == ["rt:one@example.org"]
    async with owner_engine.connect() as conn:
        for table in ("email_accounts", "account_credentials", "sync_states"):
            count = (await conn.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one()
            assert count == 0, table
    assert (await alice.client.delete(f"/api/v1/accounts/{account_id}")).status_code == 404


async def test_disconnect_deletes_credentials_even_if_revocation_fails(
    alice, registry, owner_engine
):
    account_id = await connect_mailbox(alice, registry, "one@example.org")
    registry.revoke_fails = True
    assert (await alice.client.delete(f"/api/v1/accounts/{account_id}")).status_code == 204
    async with owner_engine.connect() as conn:
        assert (
            await conn.execute(text("SELECT count(*) FROM account_credentials"))
        ).scalar_one() == 0


async def test_manual_sync_request(alice, registry, queue):
    account_id = await connect_mailbox(alice, registry, "one@example.org")
    queue.items.clear()
    response = await alice.client.post(f"/api/v1/sync/accounts/{account_id}")
    assert response.status_code == 202
    assert queue.items == [(alice.user_id, account_id)]
    status = (await alice.client.get("/api/v1/sync/status")).json()["items"]
    assert status[0]["status"] == "queued" and status[0]["initial_sync_complete"] is False
    missing = await alice.client.post(f"/api/v1/sync/accounts/{uuid.uuid4()}")
    assert missing.status_code == 404
