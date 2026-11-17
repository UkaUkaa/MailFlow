from __future__ import annotations

import json
import uuid

from sqlalchemy import text

from app.integrations.email_providers.contracts import (
    FolderRole,
    ProviderAttachment,
    ProviderUnavailable,
    ThreadAction,
)
from tests.conftest import connect_mailbox
from tests.fakes import make_message

R = FolderRole


async def _setup(actor, registry, runner, email="a@example.org"):
    account_id = await connect_mailbox(actor, registry, email)
    mailbox = registry.mailbox(email)
    mailbox.add(make_message("in1", subject="Quarterly report", minutes=1), record=False)
    mailbox.add(
        make_message("in2", subject="Lunch plans", minutes=2, is_read=True,
                     folder_ids=("Label_1",)),
        record=False,
    )  # fmt: skip
    mailbox.add(
        make_message(
            "s1", subject="Sent thing", roles=frozenset({R.SENT}), is_read=True, minutes=3
        ),
        record=False,
    )
    mailbox.add(
        make_message("t1", subject="Old junk", roles=frozenset({R.TRASH}), is_read=True, minutes=4),
        record=False,
    )
    mailbox.add(
        make_message("a1", subject="Archived memo", roles=frozenset(), is_read=True, minutes=5),
        record=False,
    )
    mailbox.add(
        make_message("st1", subject="Starred note", roles=frozenset({R.INBOX, R.STARRED}),
                     minutes=6),
        record=False,
    )  # fmt: skip
    assert await runner.run(actor.user_id, account_id) == "ok"
    return account_id, mailbox


async def _list(actor, **params):
    response = await actor.client.get("/api/v1/threads", params=params)
    assert response.status_code == 200, response.text
    return response.json()


async def _send(actor, payload, *, key=None, files=None):
    return await actor.client.post(
        "/api/v1/emails/send",
        data={"payload": json.dumps(payload)},
        files=files or [("files", ("", b"", "application/octet-stream"))] if files else None,
        headers={"Idempotency-Key": key or uuid.uuid4().hex},
    )


async def test_views(alice, registry, runner):
    await _setup(alice, registry, runner)
    subjects = lambda body: [t["subject"] for t in body["items"]]  # noqa: E731
    assert subjects(await _list(alice)) == ["Starred note", "Lunch plans", "Quarterly report"]
    assert subjects(await _list(alice, view="sent")) == ["Sent thing"]
    assert subjects(await _list(alice, view="trash")) == ["Old junk"]
    assert subjects(await _list(alice, view="archive")) == ["Archived memo"]
    assert subjects(await _list(alice, view="starred")) == ["Starred note"]
    assert subjects(await _list(alice, view="inbox", unread="true")) == [
        "Starred note", "Quarterly report",
    ]  # fmt: skip
    assert (await alice.client.get("/api/v1/threads", params={"view": "nope"})).status_code == 422


async def test_pagination_is_stable(alice, registry, runner):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    mailbox = registry.mailbox("a@example.org")
    for i in range(25):
        mailbox.add(make_message(f"m{i:02}", subject=f"S{i:02}", minutes=i), record=False)
    await runner.run(alice.user_id, account_id)
    seen: list[str] = []
    cursor = None
    for _ in range(5):
        params = {"limit": 10}
        if cursor:
            params["cursor"] = cursor
        page = await _list(alice, **params)
        seen += [t["subject"] for t in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert seen == [f"S{i:02}" for i in reversed(range(25))]
    bad = await alice.client.get("/api/v1/threads", params={"cursor": "garbage"})
    assert bad.status_code == 422


async def test_unified_inbox_and_account_filter(alice, registry, runner):
    first, _ = await _setup(alice, registry, runner, "one@example.org")
    second = await connect_mailbox(alice, registry, "two@example.org")
    registry.mailbox("two@example.org").add(
        make_message("x1", subject="Other box", minutes=30), record=False
    )
    await runner.run(alice.user_id, second)
    unified = await _list(alice)
    assert unified["items"][0]["subject"] == "Other box"
    assert {t["account_id"] for t in unified["items"]} == {str(first), str(second)}
    only = await _list(alice, account_id=str(second))
    assert [t["subject"] for t in only["items"]] == ["Other box"]


async def test_thread_detail_and_conversation(alice, registry, runner):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    mailbox = registry.mailbox("a@example.org")
    mailbox.add(make_message("c1", subject="Topic", minutes=1), record=False)
    mailbox.add(
        make_message("c2", thread_id="c1", subject="Re: Topic", sender="bob@example.com",
                     minutes=2),
        record=False,
    )  # fmt: skip
    await runner.run(alice.user_id, account_id)
    thread = (await _list(alice))["items"][0]
    assert thread["message_count"] == 2 and thread["subject"] == "Topic"
    assert [p["email"] for p in thread["participants"]] == ["alice@example.com", "bob@example.com"]
    detail = (await alice.client.get(f"/api/v1/threads/{thread['id']}")).json()
    assert [m["subject"] for m in detail["messages"]] == ["Topic", "Re: Topic"]
    message = detail["messages"][0]
    assert message["from"] == {"name": "Alice", "email": "alice@example.com"}
    assert message["body_html"] == "<p>Body</p>"
    single = await alice.client.get(f"/api/v1/emails/{message['id']}")
    assert single.json()["id"] == message["id"]


async def test_thread_actions_update_provider_and_local_state(alice, registry, runner):
    _, mailbox = await _setup(alice, registry, runner)
    thread = next(t for t in (await _list(alice))["items"] if t["subject"] == "Quarterly report")

    async def act(action):
        response = await alice.client.post(
            f"/api/v1/threads/{thread['id']}/actions", json={"action": action}
        )
        assert response.status_code == 200, response.text
        return response.json()

    assert (await act("mark_read"))["is_unread"] is False
    assert (await act("star"))["is_starred"] is True
    await act("archive")
    assert thread["id"] not in [t["id"] for t in (await _list(alice))["items"]]
    assert thread["id"] in [t["id"] for t in (await _list(alice, view="archive"))["items"]]
    await act("trash")
    assert thread["id"] in [t["id"] for t in (await _list(alice, view="trash"))["items"]]
    assert thread["id"] not in [t["id"] for t in (await _list(alice, view="archive"))["items"]]
    await act("restore")
    assert thread["id"] in [t["id"] for t in (await _list(alice))["items"]]
    await act("spam")
    assert thread["id"] in [t["id"] for t in (await _list(alice, view="spam"))["items"]]
    assert [a for _, a in mailbox.actions] == [
        ThreadAction.MARK_READ, ThreadAction.STAR, ThreadAction.ARCHIVE, ThreadAction.TRASH,
        ThreadAction.RESTORE, ThreadAction.SPAM,
    ]  # fmt: skip
    bad = await alice.client.post(
        f"/api/v1/threads/{thread['id']}/actions", json={"action": "explode"}
    )
    assert bad.status_code == 422


async def test_failed_provider_action_leaves_local_state_untouched(alice, registry, runner):
    _, mailbox = await _setup(alice, registry, runner)
    thread = (await _list(alice))["items"][0]
    mailbox.fail_with = ProviderUnavailable("down")
    response = await alice.client.post(
        f"/api/v1/threads/{thread['id']}/actions", json={"action": "trash"}
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "provider_unavailable"
    mailbox.fail_with = None
    assert thread["id"] in [t["id"] for t in (await _list(alice))["items"]]


async def test_bulk_and_message_actions(alice, registry, runner):
    await _setup(alice, registry, runner)
    ids = [t["id"] for t in (await _list(alice))["items"]]
    response = await alice.client.post(
        "/api/v1/threads/actions",
        json={"thread_ids": [*ids, str(uuid.uuid4())], "action": "mark_read"},
    )
    assert response.status_code == 200 and sorted(response.json()["updated"]) == sorted(ids)
    assert all(not t["is_unread"] for t in (await _list(alice))["items"])
    detail = (await alice.client.get(f"/api/v1/threads/{ids[0]}")).json()
    message_id = detail["messages"][0]["id"]
    unread = await alice.client.post(
        f"/api/v1/emails/{message_id}/actions", json={"action": "mark_unread"}
    )
    assert unread.json()["is_read"] is False
    not_allowed = await alice.client.post(
        f"/api/v1/emails/{message_id}/actions", json={"action": "trash"}
    )
    assert not_allowed.status_code == 422


async def test_folders_and_counts(alice, registry, runner):
    account_id, _ = await _setup(alice, registry, runner)
    folders = (await alice.client.get("/api/v1/folders")).json()["items"]
    by_name = {f["name"]: f for f in folders}
    assert by_name["Inbox"]["unread_count"] == 2 and by_name["Projects"]["role"] == "custom"
    counts = {
        c["role"]: c["unread_count"]
        for c in (await alice.client.get("/api/v1/folders/counts")).json()["items"]
    }
    assert counts["inbox"] == 2 and counts["starred"] == 1 and counts["sent"] == 0
    custom = await _list(alice, folder_id=by_name["Projects"]["id"])
    assert [t["subject"] for t in custom["items"]] == ["Lunch plans"]
    scoped = await alice.client.get("/api/v1/folders", params={"account_id": str(account_id)})
    assert len(scoped.json()["items"]) == len(folders)


async def test_search(alice, registry, runner):
    await _setup(alice, registry, runner)

    async def search(q):
        response = await alice.client.get("/api/v1/search", params={"q": q})
        assert response.status_code == 200, response.text
        return [t["subject"] for t in response.json()["items"]]

    assert await search("quarterly") == ["Quarterly report"]
    assert await search("quart") == ["Quarterly report"]  # prefix match
    assert await search("alice@example.com") != []
    assert await search("junk") == []  # trashed mail is excluded
    assert await search("') OR 1=1 --") == []
    assert await search("!!! &&& |||") == []
    assert (await alice.client.get("/api/v1/search", params={"q": ""})).status_code == 422


async def test_send_new_message_is_idempotent(alice, registry, runner):
    account_id, mailbox = await _setup(alice, registry, runner)
    payload = {
        "account_id": str(account_id),
        "to": [{"email": "Dest@Example.com", "name": "Dest"}],
        "cc": [],
        "bcc": [],
        "subject": "Hello there",
        "body_html": "<p>Hi <b>there</b></p><script>bad()</script>",
        "mode": "new",
    }
    key = "idem-key-123456"
    first = await _send(alice, payload, key=key)
    assert first.status_code == 200, first.text
    second = await _send(alice, payload, key=key)
    assert second.status_code == 200 and second.json() == first.json()
    assert len(mailbox.sent) == 1  # the provider was asked to send exactly once
    sent = mailbox.sent[0]
    assert sent.to[0].email == "dest@example.com" and sent.sender.email == "a@example.org"
    assert "script" not in sent.body_html and "Hi there" in sent.body_text
    listed = await _list(alice, view="sent")
    assert listed["items"][0]["subject"] == "Hello there"
    assert first.json()["thread_id"] == listed["items"][0]["id"]


async def test_send_validation(alice, registry, runner):
    account_id, mailbox = await _setup(alice, registry, runner)
    base = {"account_id": str(account_id), "to": [], "cc": [], "bcc": [], "subject": "x",
            "body_html": "<p>x</p>", "mode": "new"}  # fmt: skip
    no_recipient = await _send(alice, base)
    assert no_recipient.status_code == 422
    assert no_recipient.json()["error"]["details"][0]["code"] == "recipient_required"
    bad_email = await _send(alice, {**base, "to": [{"email": "not-an-email"}]})
    assert bad_email.status_code == 422
    no_key = await alice.client.post("/api/v1/emails/send", data={"payload": json.dumps(base)})
    assert no_key.status_code == 422
    unknown_account = await _send(
        alice, {**base, "account_id": str(uuid.uuid4()), "to": [{"email": "d@example.com"}]}
    )
    assert unknown_account.status_code == 404
    assert mailbox.sent == []


async def test_failed_send_can_be_retried_with_same_key(alice, registry, runner):
    account_id, mailbox = await _setup(alice, registry, runner)
    payload = {"account_id": str(account_id), "to": [{"email": "d@example.com"}], "cc": [],
               "bcc": [], "subject": "x", "body_html": "<p>x</p>", "mode": "new"}  # fmt: skip
    mailbox.fail_with = ProviderUnavailable("down")
    assert (await _send(alice, payload, key="retry-key-1234")).status_code == 502
    mailbox.fail_with = None
    assert (await _send(alice, payload, key="retry-key-1234")).status_code == 200
    assert len(mailbox.sent) == 1


async def test_reply_threads_and_sets_headers(alice, registry, runner):
    account_id, mailbox = await _setup(alice, registry, runner)
    thread = next(t for t in (await _list(alice))["items"] if t["subject"] == "Quarterly report")
    source = (await alice.client.get(f"/api/v1/threads/{thread['id']}")).json()["messages"][0]
    response = await _send(
        alice,
        {"account_id": str(account_id), "to": [{"email": "alice@example.com"}], "cc": [],
         "bcc": [], "subject": "Re: Quarterly report", "body_html": "<p>Thanks</p>",
         "mode": "reply", "source_message_id": source["id"]},
    )  # fmt: skip
    assert response.status_code == 200, response.text
    sent = mailbox.sent[0]
    assert sent.provider_thread_id == "in1"
    assert sent.in_reply_to == "<in1@example.com>" and sent.references == "<in1@example.com>"
    assert response.json()["thread_id"] == thread["id"]
    detail = (await alice.client.get(f"/api/v1/threads/{thread['id']}")).json()
    assert len(detail["messages"]) == 2


async def test_forward_includes_original_attachments_and_uploads(alice, registry, runner):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    mailbox = registry.mailbox("a@example.org")
    mailbox.add(
        make_message(
            "f1", attachments=(ProviderAttachment("2", "report.pdf", "application/pdf", 4),)
        ),
        record=False,
    )
    mailbox.attachments[("f1", "2")] = b"%PDF"
    await runner.run(alice.user_id, account_id)
    thread = (await _list(alice))["items"][0]
    source = (await alice.client.get(f"/api/v1/threads/{thread['id']}")).json()["messages"][0]
    payload = {"account_id": str(account_id), "to": [{"email": "d@example.com"}], "cc": [],
               "bcc": [], "subject": "Fwd: Hello", "body_html": "<p>FYI</p>", "mode": "forward",
               "source_message_id": source["id"],
               "forward_attachment_ids": [source["attachments"][0]["id"]]}  # fmt: skip
    response = await alice.client.post(
        "/api/v1/emails/send",
        data={"payload": json.dumps(payload)},
        files=[("files", ("../evil name.txt", b"hello", "text/plain"))],
        headers={"Idempotency-Key": uuid.uuid4().hex},
    )
    assert response.status_code == 200, response.text
    sent = mailbox.sent[0]
    assert sorted(a.filename for a in sent.attachments) == ["evil name.txt", "report.pdf"]
    assert sent.provider_thread_id is None


async def test_attachment_download_is_forced_and_safe(alice, registry, runner):
    account_id = await connect_mailbox(alice, registry, "a@example.org")
    mailbox = registry.mailbox("a@example.org")
    mailbox.add(
        make_message("f1", attachments=(ProviderAttachment("2", "page.html", "text/html", 9),)),
        record=False,
    )
    mailbox.attachments[("f1", "2")] = b"<script>1"
    await runner.run(alice.user_id, account_id)
    thread = (await _list(alice))["items"][0]
    source = (await alice.client.get(f"/api/v1/threads/{thread['id']}")).json()["messages"][0]
    response = await alice.client.get(
        f"/api/v1/attachments/{source['attachments'][0]['id']}/download"
    )
    assert response.status_code == 200 and response.content == b"<script>1"
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-disposition"].startswith('attachment; filename="page.html"')
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in response.headers["content-security-policy"]
    assert (
        await alice.client.get(f"/api/v1/attachments/{uuid.uuid4()}/download")
    ).status_code == 404


async def test_draft_lifecycle_keeps_stable_id(alice, registry, runner, owner_engine):
    account_id, mailbox = await _setup(alice, registry, runner)
    body = {"account_id": str(account_id), "to": [{"email": "d@example.com"}],
            "subject": "Draft one", "body_html": "<p>v1</p>"}  # fmt: skip
    created = await alice.client.post("/api/v1/emails/drafts", json=body)
    assert created.status_code == 201, created.text
    draft = created.json()
    assert draft["subject"] == "Draft one" and draft["mode"] == "new"
    assert [t["subject"] for t in (await _list(alice, view="drafts"))["items"]] == ["Draft one"]

    updated = await alice.client.put(
        f"/api/v1/emails/drafts/{draft['id']}", json={**body, "subject": "Draft two",
                                                       "body_html": "<p>v2</p>"}
    )  # fmt: skip
    assert updated.status_code == 200, updated.text
    assert updated.json()["id"] == draft["id"] and updated.json()["subject"] == "Draft two"
    fetched = (await alice.client.get(f"/api/v1/emails/drafts/{draft['id']}")).json()
    assert fetched["body_html"] == "<p>v2</p>"
    # A sync that replays the provider's delete+add for the edited draft keeps one row.
    assert await runner.run(alice.user_id, account_id) == "ok"
    async with owner_engine.connect() as conn:
        count = (
            await conn.execute(text("SELECT count(*) FROM email_messages WHERE is_draft"))
        ).scalar_one()
    assert count == 1
    assert (await alice.client.get(f"/api/v1/emails/drafts/{draft['id']}")).status_code == 200

    sent = await _send(alice, {**body, "cc": [], "bcc": [], "mode": "new", "subject": "Draft two",
                               "draft_id": draft["id"]})  # fmt: skip
    assert sent.status_code == 200, sent.text
    assert (await _list(alice, view="drafts"))["items"] == []
    assert mailbox.drafts == {}


async def test_delete_draft(alice, registry, runner):
    account_id, mailbox = await _setup(alice, registry, runner)
    created = await alice.client.post(
        "/api/v1/emails/drafts", json={"account_id": str(account_id), "subject": "Temp"}
    )
    draft_id = created.json()["id"]
    assert (await alice.client.delete(f"/api/v1/emails/drafts/{draft_id}")).status_code == 204
    assert mailbox.drafts == {}
    assert (await alice.client.get(f"/api/v1/emails/drafts/{draft_id}")).status_code == 404
    # A regular message is not a draft.
    thread = (await _list(alice))["items"][0]
    message = (await alice.client.get(f"/api/v1/threads/{thread['id']}")).json()["messages"][0]
    assert (await alice.client.get(f"/api/v1/emails/drafts/{message['id']}")).status_code == 404


async def test_action_on_account_needing_reauth(alice, registry, runner, owner_engine):
    await _setup(alice, registry, runner)
    async with owner_engine.begin() as conn:
        await conn.execute(text("UPDATE email_accounts SET status = 'needs_reauth'"))
    thread = (await _list(alice))["items"][0]
    response = await alice.client.post(
        f"/api/v1/threads/{thread['id']}/actions", json={"action": "star"}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "provider_auth_required"


async def test_oversized_request_rejected(alice):
    response = await alice.client.post(
        "/api/v1/emails/drafts",
        content=b"x" * 10,
        headers={"Content-Length": str(40 * 1024 * 1024), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
