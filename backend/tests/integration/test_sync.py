from __future__ import annotations

import uuid

from sqlalchemy import text

from app.integrations.email_providers.contracts import (
    FolderRole,
    ProviderAttachment,
    ProviderAuthError,
    ProviderRateLimited,
)
from tests.conftest import connect_mailbox
from tests.fakes import make_message


async def _threads(actor, **params):
    response = await actor.client.get("/api/v1/threads", params=params)
    assert response.status_code == 200, response.text
    return response.json()["items"]


async def test_initial_sync_then_incremental(alice, registry, runner):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    mailbox = registry.mailbox("a@example.org")
    for i in range(3):
        mailbox.add(make_message(f"m{i}", minutes=i, subject=f"Subject {i}"), record=False)
    assert await runner.run(alice.user_id, account_id) == "ok"
    threads = await _threads(alice)
    assert [t["subject"] for t in threads] == ["Subject 2", "Subject 1", "Subject 0"]
    status = (await alice.client.get("/api/v1/sync/status")).json()["items"][0]
    assert status["status"] == "idle" and status["initial_sync_complete"] is True

    mailbox.add(make_message("m9", minutes=9, subject="Newest"))
    mailbox.remove("m0")
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert [t["subject"] for t in await _threads(alice)] == ["Newest", "Subject 2", "Subject 1"]
    assert "synchronize" in mailbox.calls


async def test_sync_is_idempotent_and_deduplicates(alice, registry, runner, owner_engine):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    mailbox = registry.mailbox("a@example.org")
    mailbox.add(make_message("m1"), record=False)
    mailbox.add(make_message("m2", thread_id="m1", minutes=1), record=False)
    for _ in range(3):
        assert await runner.run(alice.user_id, account_id) == "ok"
    # Replay the same change twice through history as well.
    mailbox.history.extend([("upsert", "m1"), ("upsert", "m1")])
    assert await runner.run(alice.user_id, account_id) == "ok"
    async with owner_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM email_messages"))).scalar_one() == 2
        assert (await conn.execute(text("SELECT count(*) FROM email_threads"))).scalar_one() == 1
    threads = await _threads(alice)
    assert threads[0]["message_count"] == 2


async def test_backfill_is_paginated_and_resumable(alice, registry, runtime, sync_policy):
    from dataclasses import replace

    from app.infrastructure.celery.tasks import build_runner

    account_id = await connect_mailbox(alice, registry, "a@example.org")
    mailbox = registry.mailbox("a@example.org")
    for i in range(7):
        mailbox.add(make_message(f"m{i}", minutes=i), record=False)
    runner = build_runner(runtime, replace(sync_policy, page_size=2, pages_per_run=2))
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert len(await _threads(alice)) == 4  # two pages of two
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert len(await _threads(alice)) == 7


async def test_expired_cursor_triggers_full_rebuild(alice, registry, runner):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    mailbox = registry.mailbox("a@example.org")
    mailbox.add(make_message("m1"), record=False)
    mailbox.add(make_message("m2", minutes=1), record=False)
    await runner.run(alice.user_id, account_id)
    del mailbox.messages["m1"]  # deleted remotely while history was lost
    mailbox.cursor_expired = True
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert [t["snippet"] for t in await _threads(alice)] == ["snippet m2"]


async def test_revoked_grant_marks_account_for_reauth(alice, registry, runner):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    registry.mailbox("a@example.org").fail_with = ProviderAuthError("revoked")
    assert await runner.run(alice.user_id, account_id) == "error"
    account = (await alice.client.get("/api/v1/accounts")).json()["items"][0]
    assert account["status"] == "needs_reauth"
    assert account["sync"]["status"] == "error"
    assert account["sync"]["last_error_code"] == "provider_auth_required"
    # Further runs do nothing until the user reconnects.
    assert await runner.run(alice.user_id, account_id) == "inactive"


async def test_one_failing_mailbox_does_not_block_another(alice, registry, runner):
    broken = await connect_mailbox(alice, registry, "broken@example.org")
    healthy = await connect_mailbox(alice, registry, "ok@example.org")
    registry.mailbox("broken@example.org").fail_with = ProviderRateLimited(5)
    registry.mailbox("ok@example.org").add(make_message("m1"), record=False)
    assert await runner.run(alice.user_id, broken) == "error"
    assert await runner.run(alice.user_id, healthy) == "ok"
    statuses = {
        s["account_id"]: s for s in (await alice.client.get("/api/v1/sync/status")).json()["items"]
    }
    assert statuses[str(broken)]["last_error_code"] == "provider_rate_limited"
    assert statuses[str(healthy)]["status"] == "idle"
    assert len(await _threads(alice)) == 1


async def test_lock_prevents_concurrent_runs(alice, registry, runner, runtime):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    key = f"mf:u:{alice.user_id}:acct:{account_id}:sync:lock"
    await runtime.redis.set(key, "held", ex=30)
    assert await runner.run(alice.user_id, account_id) == "locked"
    assert registry.mailbox("a@example.org").calls == []


async def test_run_for_deleted_or_foreign_account_is_a_noop(alice, bob, registry, runner):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    # A task that names another tenant's account finds nothing (no cross-tenant work).
    assert await runner.run(bob.user_id, account_id) == "gone"
    await alice.client.delete(f"/api/v1/accounts/{account_id}")
    assert await runner.run(alice.user_id, account_id) == "gone"
    assert await runner.run(alice.user_id, uuid.uuid4()) == "gone"


async def test_token_refresh_when_expired(alice, registry, runner, owner_engine):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    async with owner_engine.begin() as conn:
        await conn.execute(
            text("UPDATE account_credentials SET expires_at = now() - interval '1 hour'")
        )
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert registry.refreshes == 1  # refreshed once, then reused within the run
    registry.refresh_fails = True
    async with owner_engine.begin() as conn:
        await conn.execute(
            text("UPDATE account_credentials SET expires_at = now() - interval '1 hour'")
        )
    assert await runner.run(alice.user_id, account_id) == "error"
    account = (await alice.client.get("/api/v1/accounts")).json()["items"][0]
    assert account["status"] == "needs_reauth"


async def test_rotated_refresh_token_is_persisted(alice, registry, runner, owner_engine):
    """Microsoft replaces the refresh token on every use; the next refresh must use the
    new one, not the one stored at connect time."""
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    registry.rotate_refresh_tokens = True
    for _ in range(2):
        async with owner_engine.begin() as conn:
            await conn.execute(
                text("UPDATE account_credentials SET expires_at = now() - interval '1 hour'")
            )
        assert await runner.run(alice.user_id, account_id) == "ok"
    assert registry.refresh_tokens_seen == ["rt:a@example.org", "rt:a@example.org+"]


async def test_bodies_are_sanitized_on_ingest(alice, registry, runner, owner_engine):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    hostile = (
        '<p onclick="steal()">Hi</p><script>alert(1)</script>'
        '<img src="https://tracker.test/p.gif"><a href="javascript:x()">x</a>'
    )
    registry.mailbox("a@example.org").add(make_message("m1", body_html=hostile), record=False)
    await runner.run(alice.user_id, account_id)
    async with owner_engine.connect() as conn:
        stored = (await conn.execute(text("SELECT body_html FROM email_messages"))).scalar_one()
    assert "script" not in stored and "onclick" not in stored and "javascript:" not in stored
    thread = (await _threads(alice))[0]
    detail = (await alice.client.get(f"/api/v1/threads/{thread['id']}")).json()
    assert detail["messages"][0]["has_remote_images"] is True


async def test_attachment_metadata_is_normalized(alice, registry, runner):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    attachment = ProviderAttachment("1", "../../etc/passwd", "text/html; charset=x", 12)
    registry.mailbox("a@example.org").add(
        make_message("m1", attachments=(attachment,)), record=False
    )
    await runner.run(alice.user_id, account_id)
    thread = (await _threads(alice))[0]
    assert thread["has_attachments"] is True
    detail = (await alice.client.get(f"/api/v1/threads/{thread['id']}")).json()
    stored = detail["messages"][0]["attachments"][0]
    assert stored["filename"] == "passwd" and stored["mime_type"] == "text/html"


async def test_scheduler_claims_due_accounts_once(alice, bob, registry, runtime, owner_engine):
    a = await connect_mailbox(alice, registry, "a@example.org")
    b = await connect_mailbox(bob, registry, "b@example.org")
    async with owner_engine.begin() as conn:
        await conn.execute(text("UPDATE sync_states SET next_sync_at = now() - interval '1 min'"))
    async with runtime.session_factory() as session, session.begin():
        rows = (
            await session.execute(text("SELECT * FROM mailflow_claim_due_syncs(10, 300)"))
        ).all()
        # Without tenant context the application role still cannot read the tables directly.
        direct = (await session.execute(text("SELECT count(*) FROM sync_states"))).scalar_one()
    assert {(r.user_id, r.account_id) for r in rows} == {(alice.user_id, a), (bob.user_id, b)}
    assert direct == 0
    async with runtime.session_factory() as session, session.begin():
        again = (
            await session.execute(text("SELECT * FROM mailflow_claim_due_syncs(10, 300)"))
        ).all()
    assert again == []  # leased: not handed out twice


async def test_scheduler_skips_inactive_users_and_accounts(alice, registry, runtime, owner_engine):
    await connect_mailbox(alice, registry, "a@example.org")
    async with owner_engine.begin() as conn:
        await conn.execute(text("UPDATE sync_states SET next_sync_at = now() - interval '1 min'"))
        await conn.execute(text("UPDATE users SET status = 'deactivated'"))
    async with runtime.session_factory() as session, session.begin():
        rows = (
            await session.execute(text("SELECT * FROM mailflow_claim_due_syncs(10, 300)"))
        ).all()
    assert rows == []


def test_folder_roles_are_complete():
    assert {r.value for r in FolderRole} >= {"inbox", "sent", "drafts", "trash", "spam", "archive"}


async def test_rate_limit_retries_soon_without_escalating(alice, registry, runner, owner_engine):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    registry.mailbox("a@example.org").fail_with = ProviderRateLimited(5)
    for _ in range(4):
        assert await runner.run(alice.user_id, account_id) == "error"
    async with owner_engine.connect() as conn:
        row = (
            await conn.execute(
                text(
                    "SELECT consecutive_failures, "
                    "extract(epoch FROM next_sync_at - now()) AS wait FROM sync_states"
                )
            )
        ).one()
    assert row.consecutive_failures == 0
    assert 60 <= row.wait <= 95  # quota refills each minute; no exponential back-off
