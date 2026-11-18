from __future__ import annotations

from sqlalchemy import text

from app.core.database.base import TENANT_TABLES
from tests.conftest import PASSWORD, connect_ai, connect_mailbox
from tests.fakes import make_message

USER_TABLES = (*TENANT_TABLES, "user_sessions", "email_verification_tokens",
               "password_reset_tokens")  # fmt: skip


async def _populate(actor, registry, runner, email):
    account_id = await connect_mailbox(actor, registry, email)
    registry.mailbox(email).add(make_message("m1"), record=False)
    await runner.run(actor.user_id, account_id)
    await actor.client.patch("/api/v1/settings", json={"theme": "dark"})
    assert (await actor.client.post("/api/v1/templates", json={"name": "t"})).status_code == 201
    await connect_ai(actor)
    return account_id


async def test_delete_requires_password_and_explicit_confirmation(alice):
    wrong = await alice.client.request(
        "DELETE",
        "/api/v1/users/me",
        json={"password": "wrong-password-1", "confirmation": "DELETE"},
    )
    assert wrong.status_code == 401
    unconfirmed = await alice.client.request(
        "DELETE", "/api/v1/users/me", json={"password": PASSWORD, "confirmation": "yes"}
    )
    assert unconfirmed.status_code == 422
    assert (await alice.client.get("/api/v1/auth/me")).status_code == 200


async def test_delete_account_removes_everything_and_revokes_grants(
    alice, bob, registry, runner, runtime, owner_engine
):
    account_id = await _populate(alice, registry, runner, "a@example.org")
    await _populate(bob, registry, runner, "b@example.org")
    await runtime.redis.set(f"mf:u:{alice.user_id}:cache:x", "1")
    await runtime.redis.set(f"mf:u:{bob.user_id}:cache:x", "1")

    response = await alice.client.request(
        "DELETE", "/api/v1/users/me", json={"password": PASSWORD, "confirmation": "DELETE"}
    )
    assert response.status_code == 204
    assert registry.revoked == ["rt:a@example.org"]
    assert (await alice.client.get("/api/v1/auth/me")).status_code == 401
    async with owner_engine.connect() as conn:
        assert (
            await conn.execute(
                text("SELECT count(*) FROM users WHERE id = :u"), {"u": alice.user_id}
            )
        ).scalar_one() == 0
        for table in USER_TABLES:
            count = (
                await conn.execute(
                    text(f"SELECT count(*) FROM {table} WHERE user_id = :u"), {"u": alice.user_id}
                )
            ).scalar_one()
            assert count == 0, table
        # Audit keeps only anonymous events.
        assert (
            await conn.execute(
                text("SELECT count(*) FROM audit_events WHERE user_id = :u"), {"u": alice.user_id}
            )
        ).scalar_one() == 0
        # The other tenant is untouched.
        assert (
            await conn.execute(
                text("SELECT count(*) FROM email_messages WHERE user_id = :u"), {"u": bob.user_id}
            )
        ).scalar_one() == 1
    assert await runtime.redis.keys(f"mf:u:{alice.user_id}:*") == []
    assert await runtime.redis.exists(f"mf:u:{bob.user_id}:cache:x") == 1
    # A sync task queued before deletion finds nothing to do.
    assert await runner.run(alice.user_id, account_id) == "gone"
    # The address can be registered again from scratch.
    login = await alice.client.post(
        "/api/v1/auth/login", json={"email": alice.email, "password": PASSWORD}
    )
    assert login.status_code == 401


async def test_delete_succeeds_when_provider_revocation_fails(
    alice, registry, runner, owner_engine
):
    await _populate(alice, registry, runner, "a@example.org")
    registry.revoke_fails = True
    response = await alice.client.request(
        "DELETE", "/api/v1/users/me", json={"password": PASSWORD, "confirmation": "DELETE"}
    )
    assert response.status_code == 204
    async with owner_engine.connect() as conn:
        assert (
            await conn.execute(text("SELECT count(*) FROM account_credentials"))
        ).scalar_one() == 0


async def test_deactivation_blocks_login_and_background_sync(
    alice, registry, runner, runtime, owner_engine
):
    account_id = await _populate(alice, registry, runner, "a@example.org")
    response = await alice.client.post("/api/v1/users/me/deactivate", json={"password": PASSWORD})
    assert response.status_code == 204
    assert (await alice.client.get("/api/v1/auth/me")).status_code == 401
    login = await alice.client.post(
        "/api/v1/auth/login", json={"email": alice.email, "password": PASSWORD}
    )
    assert login.status_code == 401
    async with owner_engine.begin() as conn:
        await conn.execute(text("UPDATE sync_states SET next_sync_at = now() - interval '1 min'"))
    async with runtime.session_factory() as session, session.begin():
        claimed = (
            await session.execute(text("SELECT * FROM mailflow_claim_due_syncs(10, 60)"))
        ).all()
    assert claimed == []
    # A task that was already queued before deactivation does no work either.
    assert await runner.run(alice.user_id, account_id) == "inactive"
