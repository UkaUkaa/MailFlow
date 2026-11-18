"""IMAP/SMTP provider end to end: API -> use cases -> real adapter -> GreenMail test server."""

from __future__ import annotations

import asyncio
import json
import uuid
from email import message_from_bytes

from sqlalchemy import text

from app.modules.email_accounts.application.sessions import server_credentials_to_secret
from app.modules.token_vault.domain import CredentialKind
from tests.imap_support import Mailbox, mail

ATTACHMENT_MAIL = (
    b"From: Files <files@example.org>\r\nTo: me@example.test\r\nSubject: With attachment\r\n"
    b"Message-ID: <att-1@example.org>\r\nDate: Tue, 17 Nov 2026 09:00:00 +0000\r\n"
    b'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="m"\r\n\r\n'
    b"--m\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>See attached</p>\r\n"
    b'--m\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="data.bin"\r\n'
    b"Content-Transfer-Encoding: base64\r\n\r\nAAECAwQFBgcICQ==\r\n"
    b"--m--\r\n"
)


async def connect(actor, mailbox: Mailbox, **overrides) -> uuid.UUID:
    response = await actor.client.post("/api/v1/accounts/imap", json=mailbox.payload(**overrides))
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def threads(actor, **params) -> list[dict]:
    response = await actor.client.get("/api/v1/threads", params=params)
    assert response.status_code == 200, response.text
    return response.json()["items"]


async def subjects(actor, **params) -> list[str]:
    return [t["subject"] for t in await threads(actor, **params)]


async def act(actor, thread_id: str, action: str):
    return await actor.client.post(f"/api/v1/threads/{thread_id}/actions", json={"action": action})


async def account(actor, account_id: uuid.UUID) -> dict:
    items = (await actor.client.get("/api/v1/accounts")).json()["items"]
    return next(a for a in items if a["id"] == str(account_id))


async def test_connect_via_api_then_initial_sync(
    alice, greenmail, imap_registry, queue, runner, owner_engine
):
    box = greenmail.user()
    box.deliver(mail("First", date="Tue, 17 Nov 2026 10:00:00 +0000"))
    box.deliver(
        mail("Second", date="Tue, 17 Nov 2026 11:00:00 +0000", body="<p>Hi<script>x()</script></p>")
    )
    box.deliver(mail("Read already", date="Tue, 17 Nov 2026 09:00:00 +0000"), flags="(\\Seen)")
    box.deliver(mail("I sent this", sender=box.email), folder="Sent", flags="(\\Seen)")
    box.deliver(mail("Filed away"), folder="Archive", flags="(\\Seen)")

    response = await alice.client.post(
        "/api/v1/accounts/imap", json=box.payload(display_name="  Work   mail ")
    )
    assert response.status_code == 201, response.text
    created = response.json()
    account_id = uuid.UUID(created["id"])
    assert created["provider"] == "imap" and created["status"] == "active"
    assert created["email_address"] == box.email and created["display_name"] == "Work mail"
    assert box.password not in response.text and "password" not in response.text.lower()
    assert queue.items == [(alice.user_id, account_id)]

    assert await runner.run(alice.user_id, account_id) == "ok"
    assert await subjects(alice) == ["Second", "First", "Read already"]
    assert await subjects(alice, view="sent") == ["I sent this"]
    assert await subjects(alice, view="archive") == ["Filed away"]
    inbox = await threads(alice)
    assert [t["is_unread"] for t in inbox] == [True, True, False]
    detail = (await alice.client.get(f"/api/v1/threads/{inbox[0]['id']}")).json()
    assert detail["message_count"] == 1  # no server threads: one message per conversation
    assert "script" not in detail["messages"][0]["body_html"]  # sanitized by ingestion
    assert detail["messages"][0]["from"]["email"] == "bob@example.org"
    # Synchronizing used BODY.PEEK: nothing became read on the server.
    assert sum("\\Seen" in box.flags("INBOX", uid) for uid in box.uids("INBOX")) == 1

    info = await account(alice, account_id)
    assert info["capabilities"] == {
        "threads": False, "labels": False, "server_search": False, "drafts": True,
        "spam": True, "archive": True, "incremental_sync": True,
    }  # fmt: skip
    assert info["sync"]["status"] == "idle"
    folders = (await alice.client.get("/api/v1/folders")).json()["items"]
    assert {f["role"] for f in folders} == {"inbox", "sent", "drafts", "archive", "spam", "trash"}
    async with owner_engine.connect() as conn:
        events = (
            await conn.execute(
                text(
                    "SELECT event_type, metadata FROM audit_events WHERE event_type LIKE 'account.%'"
                )
            )
        ).all()
    assert [(e.event_type, e.metadata) for e in events] == [
        ("account.connected", {"provider": "imap"})
    ]


async def test_connecting_the_same_address_again_replaces_credentials(
    alice, greenmail, imap_registry
):
    box = greenmail.user()
    account_id = await connect(alice, box)
    again = await alice.client.post("/api/v1/accounts/imap", json=box.payload())
    assert again.status_code == 200 and again.json()["id"] == str(account_id)
    assert len((await alice.client.get("/api/v1/accounts")).json()["items"]) == 1


async def test_mailbox_without_special_folders_reports_and_enforces_that(
    alice, greenmail, imap_registry, runner
):
    box = greenmail.user(folders=False)  # INBOX only
    box.deliver(mail("Only inbox"))
    account_id = await connect(alice, box)
    assert await runner.run(alice.user_id, account_id) == "ok"
    capabilities = (await account(alice, account_id))["capabilities"]
    assert (capabilities["archive"], capabilities["spam"], capabilities["drafts"]) == (
        False,
        False,
        False,
    )
    thread = (await threads(alice))[0]
    for action in ("archive", "spam", "trash"):
        response = await act(alice, thread["id"], action)
        assert response.status_code == 422 and response.json()["error"]["code"] == "unsupported"
    assert await subjects(alice) == ["Only inbox"] and box.uids("INBOX") == [1]
    draft = await alice.client.post(
        "/api/v1/emails/drafts", json={"account_id": str(account_id), "subject": "x"}
    )
    assert draft.status_code == 422 and draft.json()["error"]["code"] == "unsupported"
    assert (await act(alice, thread["id"], "star")).status_code == 200  # flags still work


async def test_incremental_sync_new_mail_flag_change_and_expunge(
    alice, greenmail, imap_registry, runner
):
    box = greenmail.user()
    for i in range(3):
        box.deliver(mail(f"Old {i}", date=f"Tue, 17 Nov 2026 10:0{i}:00 +0000"))
    account_id = await connect(alice, box)
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert await subjects(alice) == ["Old 2", "Old 1", "Old 0"]

    # Another mail client: new mail arrives, one message is read and starred, one is deleted.
    box.deliver(mail("Fresh", date="Tue, 17 Nov 2026 12:00:00 +0000"))
    other = box.client()
    other.select("INBOX")
    other.uid("STORE", "2", "+FLAGS", "(\\Seen \\Flagged)")
    other.uid("STORE", "1", "+FLAGS", "(\\Deleted)")
    other.expunge()
    other.logout()

    assert await runner.run(alice.user_id, account_id) == "ok"
    listed = await threads(alice)
    assert [t["subject"] for t in listed] == ["Fresh", "Old 2", "Old 1"]
    old_1 = next(t for t in listed if t["subject"] == "Old 1")
    assert old_1["is_unread"] is False and old_1["is_starred"] is True
    assert await subjects(alice, view="starred") == ["Old 1"]
    # A run with nothing new changes nothing.
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert await subjects(alice) == ["Fresh", "Old 2", "Old 1"]


async def test_read_star_trash_restore_and_archive_reach_the_server(
    alice, greenmail, imap_registry, runner
):
    box = greenmail.user()
    box.deliver(mail("Keep"))
    box.deliver(mail("Act on me", message_id="<act@example.org>"))
    account_id = await connect(alice, box)
    assert await runner.run(alice.user_id, account_id) == "ok"
    thread = next(t for t in await threads(alice) if t["subject"] == "Act on me")

    assert (await act(alice, thread["id"], "mark_read")).status_code == 200
    assert (await act(alice, thread["id"], "star")).status_code == 200
    assert "\\Seen" in box.flags("INBOX", 2) and "\\Flagged" in box.flags("INBOX", 2)
    assert (await act(alice, thread["id"], "mark_unread")).status_code == 200
    assert "\\Seen" not in box.flags("INBOX", 2)

    trashed = await act(alice, thread["id"], "trash")
    assert trashed.status_code == 200, trashed.text
    assert box.uids("INBOX") == [1] and len(box.uids("Trash")) == 1
    assert await subjects(alice) == ["Keep"] and await subjects(alice, view="trash") == [
        "Act on me"
    ]

    # Undo straight away, before any synchronization: the stored row followed the move.
    restored = await act(alice, thread["id"], "restore")
    assert restored.status_code == 200, restored.text
    assert box.uids("Trash") == [] and len(box.uids("INBOX")) == 2
    assert sorted(await subjects(alice)) == ["Act on me", "Keep"]

    assert (await act(alice, thread["id"], "archive")).status_code == 200
    assert len(box.uids("Archive")) == 1 and await subjects(alice, view="archive") == ["Act on me"]
    assert "\\Flagged" in box.flags("Archive", box.uids("Archive")[0])  # flags travel with it

    # The next synchronization sees the moves and keeps the very same conversation.
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert await subjects(alice) == ["Keep"]
    archived = await threads(alice, view="archive")
    assert [t["id"] for t in archived] == [thread["id"]]
    assert (await act(alice, thread["id"], "spam")).status_code == 200
    assert len(box.uids("Junk")) == 1 and await subjects(alice, view="spam") == ["Act on me"]


async def test_send_delivers_by_smtp_and_saves_a_copy_in_sent(
    alice, greenmail, imap_registry, runner, dispatcher, clock
):
    box, recipient, hidden = (
        greenmail.user(),
        greenmail.user(folders=False),
        greenmail.user(folders=False),
    )
    account_id = await connect(alice, box)
    assert await runner.run(alice.user_id, account_id) == "ok"
    payload = {
        "account_id": str(account_id),
        "to": [{"email": recipient.email, "name": "Recipient"}],
        "cc": [],
        "bcc": [{"email": hidden.email}],
        "subject": "Привіт from MailFlow",
        "body_html": "<p>Hello <b>there</b></p>",
        "mode": "new",
    }
    response = await alice.client.post(
        "/api/v1/emails/send",
        data={"payload": json.dumps(payload)},
        files=[("files", ("notes.txt", b"attached notes", "text/plain"))],
        headers={"Idempotency-Key": uuid.uuid4().hex},
    )
    # The undo window is on by default: the message is accepted, then sent by the worker.
    assert response.status_code == 202, response.text
    assert response.json()["status"] == "undoable"
    clock.advance(seconds=6)
    assert await dispatcher.run(alice.user_id, uuid.UUID(response.json()["outbox_id"])) == "sent"

    for inbox in (recipient, hidden):
        assert inbox.uids("INBOX") == [1]
    received = message_from_bytes(recipient.raw("INBOX", 1))
    assert received["From"] == box.email and "Recipient" in received["To"]
    assert received["Bcc"] is None and hidden.email not in recipient.raw("INBOX", 1).decode()
    parts = {p.get_content_type(): p for p in received.walk()}
    assert b"Hello <b>there</b>" in parts["text/html"].get_payload(decode=True)
    assert [
        p.get_payload(decode=True) for p in received.walk() if p.get_filename() == "notes.txt"
    ] == [b"attached notes"]

    assert len(box.uids("Sent")) == 1 and "\\Seen" in box.flags("Sent", 1)
    sent = await threads(alice, view="sent")
    assert [t["subject"] for t in sent] == ["Привіт from MailFlow"]
    outbox = await alice.client.get(f"/api/v1/outbox/{response.json()['outbox_id']}")
    assert outbox.json()["status"] == "sent"
    assert sent[0]["has_attachments"] is True
    # The following synchronization does not duplicate the copy.
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert await subjects(alice, view="sent") == ["Привіт from MailFlow"]


async def test_draft_create_update_delete(alice, greenmail, imap_registry, runner):
    box = greenmail.user()
    account_id = await connect(alice, box)
    assert await runner.run(alice.user_id, account_id) == "ok"
    body = {"account_id": str(account_id), "to": [{"email": "d@example.org"}],
            "subject": "Draft one", "body_html": "<p>v1</p>"}  # fmt: skip
    created = await alice.client.post("/api/v1/emails/drafts", json=body)
    assert created.status_code == 201, created.text
    draft = created.json()
    assert len(box.uids("Drafts")) == 1
    first_uid = box.uids("Drafts")[0]
    assert "\\Draft" in box.flags("Drafts", first_uid)
    assert await subjects(alice, view="drafts") == ["Draft one"]

    updated = await alice.client.put(
        f"/api/v1/emails/drafts/{draft['id']}",
        json={**body, "subject": "Draft two", "body_html": "<p>v2</p>"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["id"] == draft["id"] and updated.json()["subject"] == "Draft two"
    uids = box.uids("Drafts")
    assert len(uids) == 1 and uids[0] != first_uid  # new version appended, old one removed
    assert message_from_bytes(box.raw("Drafts", uids[0]))["Subject"] == "Draft two"
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert await subjects(alice, view="drafts") == ["Draft two"]
    fetched = await alice.client.get(f"/api/v1/emails/drafts/{draft['id']}")
    assert fetched.status_code == 200 and fetched.json()["body_html"] == "<p>v2</p>"

    assert (await alice.client.delete(f"/api/v1/emails/drafts/{draft['id']}")).status_code == 204
    assert box.uids("Drafts") == [] and await subjects(alice, view="drafts") == []
    assert box.uids("Trash") == []  # a discarded draft is removed, not moved


async def test_attachment_download(alice, greenmail, imap_registry, runner):
    box = greenmail.user()
    box.deliver(ATTACHMENT_MAIL)
    account_id = await connect(alice, box)
    assert await runner.run(alice.user_id, account_id) == "ok"
    thread = (await threads(alice))[0]
    assert thread["has_attachments"] is True
    message = (await alice.client.get(f"/api/v1/threads/{thread['id']}")).json()["messages"][0]
    [attachment] = message["attachments"]
    assert attachment["filename"] == "data.bin" and attachment["size"] == 10
    response = await alice.client.get(f"/api/v1/attachments/{attachment['id']}/download")
    assert response.status_code == 200 and response.content == bytes(range(10))
    assert response.headers["content-type"] == "application/octet-stream"
    # Still downloadable after the message moved to another folder.
    assert (await act(alice, thread["id"], "trash")).status_code == 200
    again = await alice.client.get(f"/api/v1/attachments/{attachment['id']}/download")
    assert again.status_code == 200 and again.content == bytes(range(10))
    assert "\\Seen" not in box.flags(
        "Trash", box.uids("Trash")[0]
    )  # downloading does not mark read


async def test_wrong_password_on_connect_then_needs_reauth_later(
    alice, greenmail, imap_registry, runner, queue, services_for
):
    box = greenmail.user()
    box.deliver(mail("Before", date="Tue, 17 Nov 2026 08:00:00 +0000"))
    wrong = await alice.client.post(
        "/api/v1/accounts/imap", json=box.payload(password="not-the-password")
    )
    assert wrong.status_code == 422
    assert wrong.json()["error"]["code"] == "authentication_failed"
    assert wrong.json()["error"]["details"] == [{"field": "imap", "code": "authentication_failed"}]
    assert (await alice.client.get("/api/v1/accounts")).json()["items"] == [] and queue.items == []

    account_id = await connect(alice, box)
    assert await runner.run(alice.user_id, account_id) == "ok"
    thread = (await threads(alice))[0]

    # Later the stored password stops matching the server's — what a password change at the
    # provider looks like from here. (GreenMail cannot change a password, so the stored one
    # is replaced instead; the server then rejects the login exactly as it would.)
    async with services_for(alice.user_id) as svc:
        await svc.vault.store(
            user_id=alice.user_id,
            account_id=account_id,
            kind=CredentialKind.IMAP_PASSWORD,
            secret=server_credentials_to_secret(box.credentials("outdated-password")),
        )
    box.deliver(mail("After", date="Tue, 17 Nov 2026 09:00:00 +0000"))

    assert await runner.run(alice.user_id, account_id) == "error"
    info = await account(alice, account_id)
    assert (
        info["status"] == "needs_reauth"
        and info["sync"]["last_error_code"] == "provider_auth_required"
    )
    blocked = await act(alice, thread["id"], "star")
    assert (
        blocked.status_code == 409 and blocked.json()["error"]["code"] == "provider_auth_required"
    )
    assert (
        await runner.run(alice.user_id, account_id) == "inactive"
    )  # no retries with a dead password
    oauth = await alice.client.post(f"/api/v1/accounts/{account_id}/reconnect", json={})
    assert oauth.status_code == 422 and oauth.json()["error"]["code"] == "unsupported"

    path = f"/api/v1/accounts/{account_id}/imap/credentials"
    still_wrong = await alice.client.post(path, json={"password": "another-wrong-one"})
    assert (
        still_wrong.status_code == 422
        and still_wrong.json()["error"]["code"] == "authentication_failed"
    )
    assert (await account(alice, account_id))["status"] == "needs_reauth"
    fixed = await alice.client.post(path, json={"password": box.password})
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["status"] == "active" and box.password not in fixed.text
    assert queue.items[-1] == (alice.user_id, account_id)
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert await subjects(alice) == ["After", "Before"]
    assert (await act(alice, thread["id"], "star")).status_code == 200


async def test_uidvalidity_change_rebuilds_the_local_copy(alice, greenmail, imap_registry, runner):
    box = greenmail.user()
    client = box.client()
    client.create("Projects")
    client.logout()
    box.deliver(mail("Inbox stays"))
    box.deliver(mail("Project A"), folder="Projects")
    box.deliver(mail("Project B"), folder="Projects")
    account_id = await connect(alice, box)
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert sorted(await subjects(alice, view="archive")) == ["Project A", "Project B"]
    before = {t["subject"]: t["id"] for t in await threads(alice)}

    # The folder is replaced by a new one of the same name: same path, new UIDVALIDITY, and
    # UID 1 now means a different message.
    client = box.client()
    old_validity = client.status("Projects", "(UIDVALIDITY)")[1][0]
    await asyncio.sleep(1.1)  # GreenMail derives UIDVALIDITY from the creation second
    assert client.rename("Projects", "Projects-2025")[0] == "OK"
    assert client.create("Projects")[0] == "OK"
    assert client.status("Projects", "(UIDVALIDITY)")[1][0] != old_validity
    client.logout()
    box.deliver(mail("Project C"), folder="Projects")

    assert await runner.run(alice.user_id, account_id) == "ok"
    assert sorted(await subjects(alice, view="archive")) == ["Project A", "Project B", "Project C"]
    after = {t["subject"]: t["id"] for t in await threads(alice)}
    assert (
        set(after) == {"Inbox stays"} and after["Inbox stays"] != before["Inbox stays"]
    )  # rebuilt
    # "Project C" really is the new message, not a stale row that happened to share UID 1.
    current = next(t for t in await threads(alice, view="archive") if t["subject"] == "Project C")
    detail = (await alice.client.get(f"/api/v1/threads/{current['id']}")).json()
    assert detail["messages"][0]["subject"] == "Project C"
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert len(await threads(alice, view="archive")) == 3 and await subjects(alice) == [
        "Inbox stays"
    ]


async def test_disconnect_removes_credentials_and_mail(
    alice, greenmail, imap_registry, runner, owner_engine
):
    box = greenmail.user()
    box.deliver(mail("Bye"))
    account_id = await connect(alice, box)
    assert await runner.run(alice.user_id, account_id) == "ok"
    assert (await alice.client.delete(f"/api/v1/accounts/{account_id}")).status_code == 204
    async with owner_engine.connect() as conn:
        for table in ("account_credentials", "email_messages", "email_accounts"):
            assert (await conn.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one() == 0
    assert box.uids("INBOX") == [1]  # the mailbox itself is untouched
