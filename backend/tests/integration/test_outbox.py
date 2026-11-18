"""Scheduled outbox: send later and undo send (D42)."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timedelta

from sqlalchemy import text

from app.core.database.engine import tenant_transaction
from app.infrastructure.celery.tasks import build_dispatcher, dispatch_due_outbox
from app.integrations.email_providers.contracts import ProviderUnavailable
from tests.conftest import connect_mailbox, set_undo_send
from tests.fakes import RecordingOutboxQueue

OUTBOX = "/api/v1/outbox"


async def _mailbox(actor, registry, runner, email="a@example.org"):
    account_id = await connect_mailbox(actor, registry, email)
    assert await runner.run(actor.user_id, account_id) == "ok"
    return account_id, registry.mailbox(email)


def _payload(account_id, **extra):
    return {
        "account_id": str(account_id),
        "to": [{"email": "dest@example.com", "name": "Dest"}],
        "cc": [],
        "bcc": [],
        "subject": "Hello",
        "body_html": "<p>Body <b>text</b></p>",
        "mode": "new",
        **extra,
    }


async def _send(actor, payload, *, key=None, files=None):
    return await actor.client.post(
        "/api/v1/emails/send",
        data={"payload": json.dumps(payload)},
        files=files,
        headers={"Idempotency-Key": key or uuid.uuid4().hex},
    )


def _at(clock, **delta) -> str:
    return (clock.now() + timedelta(**delta)).isoformat()


async def _status(actor, outbox_id) -> str:
    response = await actor.client.get(f"{OUTBOX}/{outbox_id}")
    assert response.status_code == 200, response.text
    return response.json()["status"]


# -- undo send -----------------------------------------------------------------------------


async def test_undo_setting_defaults_on_and_validates(alice):
    assert (await alice.client.get("/api/v1/settings")).json()["undo_send_seconds"] == 5
    bad = await alice.client.patch("/api/v1/settings", json={"undo_send_seconds": 7})
    assert bad.status_code == 422
    await set_undo_send(alice, 30)
    assert (await alice.client.get("/api/v1/settings")).json()["undo_send_seconds"] == 30


async def test_normal_send_waits_for_the_undo_window(
    alice, registry, runner, dispatcher, clock, outbox_queue
):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    await set_undo_send(alice, 10)
    response = await _send(alice, _payload(account_id))
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "undoable" and body["undo_seconds"] == 10
    assert body["message_id"] is None and body["send_at"] is not None
    outbox_id = uuid.UUID(body["outbox_id"])
    # A worker is asked to send it when the window closes; the task carries ids only.
    assert outbox_queue.enqueued == [(alice.user_id, outbox_id, 10)]
    # Inside the window nothing goes out, even if a worker runs early.
    assert await dispatcher.run(alice.user_id, outbox_id) == "skipped"
    assert mailbox.sent == []
    # Undo-window items are not part of the Scheduled list.
    assert (await alice.client.get(OUTBOX)).json()["items"] == []

    clock.advance(seconds=11)
    assert await dispatcher.run(alice.user_id, outbox_id) == "sent"
    assert len(mailbox.sent) == 1 and mailbox.sent[0].subject == "Hello"
    detail = (await alice.client.get(f"{OUTBOX}/{outbox_id}")).json()
    assert detail["status"] == "sent" and detail["body_html"] == ""  # stored copy erased
    # Too late to undo.
    late = await alice.client.post(f"{OUTBOX}/{outbox_id}/cancel")
    assert late.status_code == 409 and late.json()["error"]["code"] == "outbox_not_cancellable"
    assert len(mailbox.sent) == 1


async def test_cancel_inside_the_undo_window_prevents_the_send(
    alice, registry, runner, dispatcher, clock
):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    key = uuid.uuid4().hex
    response = await _send(
        alice,
        _payload(account_id),
        key=key,
        files=[("files", ("notes.txt", b"attached notes", "text/plain"))],
    )
    outbox_id = response.json()["outbox_id"]

    cancelled = await alice.client.post(f"{OUTBOX}/{outbox_id}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    body = cancelled.json()
    # Everything the composer needs to reopen the message comes back.
    assert body["status"] == "cancelled"
    assert body["subject"] == "Hello" and body["to"][0]["email"] == "dest@example.com"
    assert "Body" in body["body_html"]
    assert body["attachments"] == [{"filename": "notes.txt", "mime_type": "text/plain", "size": 14}]

    clock.advance(seconds=60)
    assert await dispatcher.run(alice.user_id, uuid.UUID(outbox_id)) == "skipped"
    assert mailbox.sent == []
    # Cancelling twice, or replaying the cancelled request, never sends.
    assert (await alice.client.post(f"{OUTBOX}/{outbox_id}/cancel")).status_code == 409
    replay = await _send(alice, _payload(account_id), key=key)
    assert replay.status_code == 409 and replay.json()["error"]["code"] == "send_cancelled"
    assert mailbox.sent == []


async def test_cancelled_content_is_erased(alice, registry, runner, owner_engine):
    account_id, _ = await _mailbox(alice, registry, runner)
    response = await _send(
        alice, _payload(account_id), files=[("files", ("a.txt", b"secret", "text/plain"))]
    )
    await alice.client.post(f"{OUTBOX}/{response.json()['outbox_id']}/cancel")
    async with owner_engine.connect() as conn:
        bodies = (await conn.execute(text("SELECT body_html, snippet FROM outbox_items"))).all()
        files = (await conn.execute(text("SELECT count(*) FROM outbox_attachments"))).scalar()
    assert bodies == [("", "")] and files == 0


async def test_undo_off_sends_immediately(alice, registry, runner, outbox_queue):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    await set_undo_send(alice, 0)
    response = await _send(alice, _payload(account_id))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "sent" and body["message_id"] and body["outbox_id"] is None
    assert len(mailbox.sent) == 1 and outbox_queue.enqueued == []


async def test_repeating_a_queued_request_does_not_queue_twice(
    alice, registry, runner, dispatcher, clock, owner_engine
):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    key = uuid.uuid4().hex
    first, second = await asyncio.gather(
        _send(alice, _payload(account_id), key=key), _send(alice, _payload(account_id), key=key)
    )
    assert first.status_code == second.status_code == 202
    assert first.json()["outbox_id"] == second.json()["outbox_id"]
    async with owner_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM outbox_items"))).scalar() == 1
    clock.advance(seconds=6)
    outbox_id = uuid.UUID(first.json()["outbox_id"])
    assert await dispatcher.run(alice.user_id, outbox_id) == "sent"
    # After delivery the same request reports the sent message instead of sending again.
    replay = await _send(alice, _payload(account_id), key=key)
    assert replay.status_code == 200 and replay.json()["status"] == "sent"
    assert replay.json()["message_id"] is not None
    assert len(mailbox.sent) == 1


# -- send later ----------------------------------------------------------------------------


async def test_send_later_lists_reschedules_and_sends(
    alice, registry, runner, dispatcher, clock, outbox_queue
):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    response = await _send(
        alice,
        _payload(account_id, send_at=_at(clock, hours=2)),
        files=[("files", ("notes.txt", b"attached notes", "text/plain"))],
    )
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "scheduled" and body["undo_seconds"] == 0
    outbox_id = uuid.UUID(body["outbox_id"])
    assert outbox_queue.enqueued == []  # far away: left to the beat scan

    items = (await alice.client.get(OUTBOX)).json()["items"]
    assert [i["id"] for i in items] == [str(outbox_id)]
    assert items[0]["status"] == "pending" and items[0]["attachment_count"] == 1
    assert items[0]["snippet"] == "Body text" and "body_html" not in items[0]

    # Move it a day later: the original time passes without a send.
    moved = await alice.client.patch(f"{OUTBOX}/{outbox_id}", json={"send_at": _at(clock, days=1)})
    assert moved.status_code == 200, moved.text
    clock.advance(hours=3)
    assert await dispatcher.run(alice.user_id, outbox_id) == "skipped"
    assert mailbox.sent == []

    clock.advance(days=1)
    assert await dispatcher.run(alice.user_id, outbox_id) == "sent"
    assert len(mailbox.sent) == 1
    assert [a.filename for a in mailbox.sent[0].attachments] == ["notes.txt"]
    assert mailbox.sent[0].attachments[0].content == b"attached notes"
    assert (await alice.client.get(OUTBOX)).json()["items"] == []
    # A sent message cannot be rescheduled.
    again = await alice.client.patch(f"{OUTBOX}/{outbox_id}", json={"send_at": _at(clock, hours=1)})
    assert again.status_code == 409 and again.json()["error"]["code"] == "outbox_not_editable"


async def test_rescheduling_to_a_near_time_hands_the_item_to_a_worker(
    alice, registry, runner, clock, outbox_queue
):
    account_id, _ = await _mailbox(alice, registry, runner)
    response = await _send(alice, _payload(account_id, send_at=_at(clock, days=3)))
    outbox_id = uuid.UUID(response.json()["outbox_id"])
    moved = await alice.client.patch(
        f"{OUTBOX}/{outbox_id}", json={"send_at": _at(clock, seconds=30)}
    )
    assert moved.status_code == 200
    assert [(u, o) for u, o, _ in outbox_queue.enqueued] == [(alice.user_id, outbox_id)]
    assert 28 <= outbox_queue.enqueued[0][2] <= 30


async def test_send_at_validation(alice, registry, runner, clock):
    account_id, mailbox = await _mailbox(alice, registry, runner)

    async def problem(send_at) -> str:
        response = await _send(alice, _payload(account_id, send_at=send_at))
        assert response.status_code == 422, response.text
        return response.json()["error"]["details"][0]["code"]

    assert await problem(_at(clock, minutes=-5)) == "in_past"
    assert await problem(_at(clock, days=400)) == "too_far"
    # Local time without knowing the user's time zone cannot be placed on the timeline.
    assert await problem("2030-01-01T10:00:00") == "timezone_required"
    # The same checks a direct send makes are made before anything is queued.
    no_recipient = await _send(alice, _payload(account_id, to=[], send_at=_at(clock, hours=1)))
    assert no_recipient.status_code == 422
    foreign = await _send(alice, _payload(uuid.uuid4(), send_at=_at(clock, hours=1)))
    assert foreign.status_code == 404
    assert (await alice.client.get(OUTBOX)).json()["items"] == [] and mailbox.sent == []

    scheduled = await _send(alice, _payload(account_id, send_at=_at(clock, hours=1)))
    outbox_id = scheduled.json()["outbox_id"]
    bad = await alice.client.patch(f"{OUTBOX}/{outbox_id}", json={"send_at": _at(clock, days=-1)})
    assert bad.status_code == 422


# -- workers -------------------------------------------------------------------------------


async def test_two_workers_send_one_message(alice, registry, runner, runtime, clock):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    response = await _send(alice, _payload(account_id))
    outbox_id = uuid.UUID(response.json()["outbox_id"])
    clock.advance(seconds=6)
    # Two workers got the same task (redelivery, or the direct hand-off plus the beat scan).
    workers = [build_dispatcher(runtime) for _ in range(4)]
    outcomes = await asyncio.gather(*(w.run(alice.user_id, outbox_id) for w in workers))
    assert sorted(outcomes) == ["sent", "skipped", "skipped", "skipped"]
    assert len(mailbox.sent) == 1
    assert await _status(alice, outbox_id) == "sent"


async def test_beat_scan_hands_out_each_due_item_once(
    alice, registry, runner, runtime, clock, owner_engine
):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    ids = set()
    for _ in range(3):
        response = await _send(alice, _payload(account_id, send_at=_at(clock, hours=1)))
        ids.add(uuid.UUID(response.json()["outbox_id"]))
    not_due = await _send(alice, _payload(account_id, send_at=_at(clock, days=2)))

    queue = RecordingOutboxQueue()
    assert await dispatch_due_outbox(runtime, queue) == 0  # nothing is due yet
    async with owner_engine.begin() as conn:  # the scan uses the database clock
        await conn.execute(
            text(
                "UPDATE outbox_items SET send_at = now() - interval '1 second', "
                "next_attempt_at = now() - interval '1 second' WHERE id <> :keep"
            ),
            {"keep": not_due.json()["outbox_id"]},
        )
    # Concurrent scans (two beat processes) never hand out the same row twice.
    counts = await asyncio.gather(*(dispatch_due_outbox(runtime, queue) for _ in range(3)))
    assert sum(counts) == 3
    assert {(u, o) for u, o, _ in queue.enqueued} == {(alice.user_id, i) for i in ids}
    assert len(queue.enqueued) == 3
    assert await dispatch_due_outbox(runtime, queue) == 0  # leased until the workers report

    clock.advance(hours=2)
    dispatcher = build_dispatcher(runtime)
    for user_id, outbox_id, _ in queue.enqueued:
        assert await dispatcher.run(user_id, outbox_id) == "sent"
    assert len(mailbox.sent) == 3


async def test_worker_that_died_after_sending_does_not_send_again(
    alice, registry, runner, dispatcher, clock, owner_engine
):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    response = await _send(alice, _payload(account_id))
    outbox_id = uuid.UUID(response.json()["outbox_id"])
    clock.advance(seconds=6)
    assert await dispatcher.run(alice.user_id, outbox_id) == "sent"
    # Simulate: the provider accepted the message but the worker died before recording it.
    async with owner_engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE outbox_items SET status = 'sending', message_id = NULL, "
                "locked_until = now() - interval '1 minute'"
            )
        )
    clock.advance(seconds=1)
    # The item is claimed again once the lease expires; the send path's idempotency key
    # answers with the first result instead of contacting the provider.
    assert await dispatcher.run(alice.user_id, outbox_id) == "sent"
    assert len(mailbox.sent) == 1
    detail = (await alice.client.get(f"{OUTBOX}/{outbox_id}")).json()
    assert detail["status"] == "sent"


async def test_provider_outage_is_retried_then_reported(alice, registry, runner, dispatcher, clock):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    response = await _send(alice, _payload(account_id))
    outbox_id = uuid.UUID(response.json()["outbox_id"])
    mailbox.fail_with = ProviderUnavailable("down")
    clock.advance(seconds=6)
    assert await dispatcher.run(alice.user_id, outbox_id) == "retry"
    assert await _status(alice, outbox_id) == "pending"
    assert await dispatcher.run(alice.user_id, outbox_id) == "skipped"  # backing off
    clock.advance(minutes=2)
    assert await dispatcher.run(alice.user_id, outbox_id) == "retry"
    clock.advance(minutes=5)
    assert await dispatcher.run(alice.user_id, outbox_id) == "failed"  # third and last try
    assert mailbox.sent == []

    # A failed send is visible in the Scheduled list, whatever its origin.
    items = (await alice.client.get(OUTBOX)).json()["items"]
    assert [(i["status"], i["error_code"]) for i in items] == [("failed", "provider_unavailable")]

    # Rescheduling a failed item queues it again; this time the provider is back.
    mailbox.fail_with = None
    retried = await alice.client.patch(
        f"{OUTBOX}/{outbox_id}", json={"send_at": _at(clock, minutes=1)}
    )
    assert retried.status_code == 200 and retried.json()["status"] == "pending"
    clock.advance(minutes=2)
    assert await dispatcher.run(alice.user_id, outbox_id) == "sent"
    assert len(mailbox.sent) == 1


async def test_account_needing_reauth_fails_the_item(
    alice, registry, runner, dispatcher, clock, owner_engine
):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    response = await _send(alice, _payload(account_id, send_at=_at(clock, hours=1)))
    outbox_id = uuid.UUID(response.json()["outbox_id"])
    async with owner_engine.begin() as conn:
        await conn.execute(text("UPDATE email_accounts SET status = 'needs_reauth'"))
    clock.advance(hours=2)
    # The worker re-reads the account; an inactive mailbox is never used.
    assert await dispatcher.run(alice.user_id, outbox_id) == "failed"
    assert mailbox.sent == []
    item = (await alice.client.get(OUTBOX)).json()["items"][0]
    assert item["error_code"] == "provider_auth_required"
    # The user can still take the message back.
    assert (await alice.client.post(f"{OUTBOX}/{outbox_id}/cancel")).status_code == 200


async def test_disconnecting_the_account_drops_its_scheduled_sends(
    alice, registry, runner, dispatcher, clock
):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    response = await _send(alice, _payload(account_id, send_at=_at(clock, hours=1)))
    outbox_id = uuid.UUID(response.json()["outbox_id"])
    assert (await alice.client.delete(f"/api/v1/accounts/{account_id}")).status_code == 204
    assert (await alice.client.get(f"{OUTBOX}/{outbox_id}")).status_code == 404
    clock.advance(hours=2)
    assert await dispatcher.run(alice.user_id, outbox_id) == "skipped"
    assert mailbox.sent == []


async def test_deleted_draft_does_not_block_a_scheduled_send(
    alice, registry, runner, dispatcher, clock
):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    draft = await alice.client.post(
        "/api/v1/emails/drafts", json={"account_id": str(account_id), "subject": "Hello"}
    )
    draft_id = draft.json()["id"]
    response = await _send(
        alice, _payload(account_id, draft_id=draft_id, send_at=_at(clock, hours=1))
    )
    assert response.status_code == 202, response.text
    assert (await alice.client.delete(f"/api/v1/emails/drafts/{draft_id}")).status_code == 204
    clock.advance(hours=2)
    outbox_id = uuid.UUID(response.json()["outbox_id"])
    assert await dispatcher.run(alice.user_id, outbox_id) == "sent"
    assert len(mailbox.sent) == 1


# -- tenant isolation ----------------------------------------------------------------------


async def test_another_users_outbox_item_is_404(
    alice, bob, registry, runner, runtime, dispatcher, clock
):
    account_id, mailbox = await _mailbox(alice, registry, runner)
    await _mailbox(bob, registry, runner, "b@example.org")
    response = await _send(alice, _payload(account_id, send_at=_at(clock, hours=1)))
    outbox_id = response.json()["outbox_id"]

    assert (await bob.client.get(OUTBOX)).json()["items"] == []
    attempts = await asyncio.gather(
        bob.client.get(f"{OUTBOX}/{outbox_id}"),
        bob.client.patch(f"{OUTBOX}/{outbox_id}", json={"send_at": _at(clock, minutes=5)}),
        bob.client.post(f"{OUTBOX}/{outbox_id}/cancel"),
    )
    for attempt in attempts:
        assert attempt.status_code == 404, (attempt.request.method, attempt.text)
        assert attempt.json()["error"]["code"] == "not_found"
    # Bob cannot schedule from Alice's mailbox either.
    foreign = await _send(bob, _payload(account_id, send_at=_at(clock, hours=1)))
    assert foreign.status_code == 404

    # Row-level security: Bob's tenant context sees no outbox rows at all.
    async with tenant_transaction(runtime.session_factory, bob.user_id) as session:
        for table in ("outbox_items", "outbox_attachments"):
            assert (await session.execute(text(f"SELECT count(*) FROM {table}"))).scalar() == 0
        touched = await session.execute(
            text("UPDATE outbox_items SET status = 'cancelled' WHERE id = :id"), {"id": outbox_id}
        )
        assert touched.rowcount == 0

    # A task forged with Bob's user id and Alice's item id finds nothing to send.
    clock.advance(hours=2)
    assert await dispatcher.run(bob.user_id, uuid.UUID(outbox_id)) == "skipped"
    assert mailbox.sent == []
    # Alice's item is untouched and still goes out for her.
    assert await _status(alice, outbox_id) == "pending"
    assert await dispatcher.run(alice.user_id, uuid.UUID(outbox_id)) == "sent"
    assert len(mailbox.sent) == 1


async def test_idempotency_keys_are_scoped_to_the_user(alice, bob, registry, runner, clock):
    alice_account, _ = await _mailbox(alice, registry, runner)
    bob_account, _ = await _mailbox(bob, registry, runner, "b@example.org")
    key = "shared-key-12345"
    first = await _send(alice, _payload(alice_account, send_at=_at(clock, hours=1)), key=key)
    second = await _send(bob, _payload(bob_account, send_at=_at(clock, hours=1)), key=key)
    assert first.status_code == second.status_code == 202
    assert first.json()["outbox_id"] != second.json()["outbox_id"]


async def test_scan_skips_deactivated_users(alice, registry, runner, runtime, owner_engine, clock):
    account_id, _ = await _mailbox(alice, registry, runner)
    await _send(alice, _payload(account_id, send_at=_at(clock, hours=1)))
    async with owner_engine.begin() as conn:
        await conn.execute(text("UPDATE outbox_items SET next_attempt_at = now() - interval '1s'"))
        await conn.execute(text("UPDATE users SET status = 'deactivated'"))
    queue = RecordingOutboxQueue()
    assert await dispatch_due_outbox(runtime, queue) == 0


# -- user time zone ------------------------------------------------------------------------


async def test_local_time_is_converted_from_the_users_time_zone(
    alice, registry, runner, clock, owner_engine
):
    """The user picks a wall-clock time; the ``mf_tz`` cookie says where they are; the server
    stores and sends at the corresponding UTC moment."""
    from zoneinfo import ZoneInfo

    account_id, _ = await _mailbox(alice, registry, runner)
    kyiv = ZoneInfo("Europe/Kyiv")
    local = (clock.now().astimezone(kyiv) + timedelta(days=30)).replace(
        hour=9, minute=0, second=0, microsecond=0
    )
    wall = local.replace(tzinfo=None).isoformat()  # e.g. 2026-12-18T09:00:00, no offset
    alice.client.cookies.set("mf_tz", "Europe/Kyiv")

    response = await _send(alice, _payload(account_id, send_at=wall))
    assert response.status_code == 202, response.text
    stored = datetime.fromisoformat(response.json()["send_at"])
    assert stored == local  # the same instant...
    assert stored.utcoffset() == timedelta(0)  # ...reported in server time (UTC)

    # Rescheduling reads local time the same way, from wherever the user is now.
    alice.client.cookies.set("mf_tz", "America/New_York")
    moved = await alice.client.patch(
        f"{OUTBOX}/{response.json()['outbox_id']}", json={"send_at": wall}
    )
    assert moved.status_code == 200, moved.text
    expected = local.replace(tzinfo=ZoneInfo("America/New_York"))
    assert datetime.fromisoformat(moved.json()["send_at"]) == expected

    # A time with its own offset does not depend on the cookie.
    explicit = await _send(alice, _payload(account_id, send_at=local.isoformat()))
    assert datetime.fromisoformat(explicit.json()["send_at"]) == local


async def test_percent_encoded_time_zone_cookie_is_accepted(alice, registry, runner, clock):
    """The browser writes the zone with ``encodeURIComponent``: ``Europe%2FKyiv``."""
    account_id, _ = await _mailbox(alice, registry, runner)
    wall = (clock.now() + timedelta(days=2)).replace(tzinfo=None, microsecond=0).isoformat()
    alice.client.cookies.set("mf_tz", "Europe%2FKyiv")

    response = await _send(alice, _payload(account_id, send_at=wall))
    assert response.status_code == 202, response.text
    assert response.json()["status"] == "scheduled"


async def test_unknown_time_zone_cookie_is_rejected(alice, registry, runner):
    account_id, _ = await _mailbox(alice, registry, runner)
    for bogus in ("Mars/Olympus", "../../etc/passwd", ""):
        alice.client.cookies.set("mf_tz", bogus)
        response = await _send(alice, _payload(account_id, send_at="2030-01-01T10:00:00"))
        assert response.status_code == 422, (bogus, response.text)
        assert response.json()["error"]["details"][0]["code"] == "timezone_required"
