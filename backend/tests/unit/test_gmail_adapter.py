"""Gmail adapter against a mocked Gmail REST API (respx). No real network."""

from __future__ import annotations

import base64
import email
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import respx

from app.integrations.email_providers.contracts import (
    Address,
    Credentials,
    FolderRole,
    OutgoingAttachment,
    OutgoingMessage,
    ProviderAuthError,
    ProviderCursorExpired,
    ProviderNotFound,
    ProviderRateLimited,
    ProviderUnavailable,
    ThreadAction,
)
from app.integrations.email_providers.gmail import mapper
from app.integrations.email_providers.gmail.oauth import (
    AUTH_URL,
    PROFILE_URL,
    REVOKE_URL,
    SCOPES,
    TOKEN_URL,
    GoogleOAuthClient,
)
from app.integrations.email_providers.gmail.provider import API, GmailProvider

CREDS = Credentials(access_token="access-123", refresh_token="refresh-456")


def b64(text: str | bytes) -> str:
    raw = text.encode() if isinstance(text, str) else text
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def gmail_message(message_id="m1", labels=("INBOX", "UNREAD"), **extra):
    return {
        "id": message_id,
        "threadId": "t1",
        "labelIds": list(labels),
        "snippet": "Hello snippet",
        "internalDate": "1767225600000",
        "sizeEstimate": 1234,
        "payload": {
            "mimeType": "multipart/mixed",
            "headers": [
                {"name": "From", "value": '"Alice Sender" <Alice@Example.com>'},
                {"name": "To", "value": "Bob <bob@example.com>, carol@example.com"},
                {"name": "Cc", "value": "not-an-address, dave@example.com"},
                {"name": "Subject", "value": "Quarterly numbers"},
                {"name": "Message-ID", "value": "<abc@mail.example.com>"},
                {"name": "References", "value": "<r1@x> <r2@x>"},
            ],
            "parts": [
                {
                    "partId": "0",
                    "mimeType": "multipart/alternative",
                    "parts": [
                        {"partId": "0.0", "mimeType": "text/plain",
                         "body": {"data": b64("Plain body"), "size": 10}},
                        {"partId": "0.1", "mimeType": "text/html",
                         "headers": [{"name": "Content-Type",
                                      "value": "text/html; charset=utf-8"}],
                         "body": {"data": b64("<p>HTML <b>body</b></p>"), "size": 20}},
                    ],
                },
                {"partId": "1", "mimeType": "application/pdf", "filename": "report.pdf",
                 "headers": [{"name": "Content-Disposition", "value": "attachment"}],
                 "body": {"attachmentId": "att-volatile-1", "size": 2048}},
                {"partId": "2", "mimeType": "image/png", "filename": "logo.png",
                 "headers": [{"name": "Content-Disposition", "value": "inline"},
                             {"name": "Content-ID", "value": "<logo@x>"}],
                 "body": {"attachmentId": "att-volatile-2", "size": 512}},
            ],
        },
        **extra,
    }  # fmt: skip


async def no_sleep(_: float) -> None:
    return None


@pytest.fixture
async def http():
    async with httpx.AsyncClient() as client:
        yield client


@pytest.fixture
def provider(http):
    return GmailProvider(http, CREDS, sleep=no_sleep)


@pytest.fixture
def oauth(http):
    return GoogleOAuthClient(
        http, client_id="cid", client_secret="csecret", redirect_uri="https://app.test/cb"
    )


# -- mapper ----------------------------------------------------------------------------------


def test_map_message_normalizes_headers_bodies_and_attachments():
    message = mapper.map_message(gmail_message())
    assert message.provider_message_id == "m1" and message.provider_thread_id == "t1"
    assert message.sender == Address(email="alice@example.com", name="Alice Sender")
    assert [a.email for a in message.to] == ["bob@example.com", "carol@example.com"]
    assert [a.email for a in message.cc] == ["dave@example.com"]  # invalid entry dropped
    assert message.subject == "Quarterly numbers"
    assert message.body_text == "Plain body" and message.body_html == "<p>HTML <b>body</b></p>"
    assert message.is_read is False and message.roles == frozenset({FolderRole.INBOX})
    assert message.sent_at == datetime(2026, 1, 1, tzinfo=UTC)
    assert message.rfc822_message_id == "<abc@mail.example.com>"
    report, logo = message.attachments
    assert (report.part_id, report.filename, report.size, report.is_inline) == (
        "1", "report.pdf", 2048, False,
    )  # fmt: skip
    assert logo.is_inline is True and logo.content_id == "logo@x"


def test_map_message_labels_and_roles():
    message = mapper.map_message(
        gmail_message(labels=("SENT", "STARRED", "Label_7", "CATEGORY_SOCIAL", "IMPORTANT"))
    )
    assert message.is_read and message.is_starred
    assert message.roles == frozenset({FolderRole.SENT, FolderRole.STARRED})
    assert message.folder_ids == ("Label_7",)
    draft = mapper.map_message(gmail_message(labels=("DRAFT",)), draft_id="d9")
    assert draft.is_draft and draft.provider_draft_id == "d9"


def test_map_message_tolerates_minimal_and_broken_payloads():
    minimal = mapper.map_message({"id": "x"})
    assert minimal.provider_thread_id == "x" and minimal.sender is None and minimal.subject == ""
    broken = gmail_message()
    broken["payload"]["parts"][0]["parts"][1]["body"]["data"] = "!!!not-base64!!!"
    broken["payload"]["parts"][0]["parts"][1]["headers"] = [
        {"name": "Content-Type", "value": "text/html; charset=does-not-exist"}
    ]
    assert mapper.map_message(broken).body_html is not None


def test_map_labels():
    folders = mapper.map_labels(
        [
            {"id": "INBOX", "name": "INBOX", "type": "system"},
            {"id": "CATEGORY_PROMOTIONS", "name": "x", "type": "system"},
            {"id": "Label_1", "name": "Projects/2026", "type": "user"},
        ]
    )
    assert [(f.provider_folder_id, f.role) for f in folders] == [
        ("INBOX", FolderRole.INBOX), ("Label_1", FolderRole.CUSTOM),
    ]  # fmt: skip


def test_build_mime_structure_and_header_injection():
    raw = mapper.build_mime(
        OutgoingMessage(
            sender=Address("me@example.com"),
            to=(Address("you@example.com", "You, Esq."),),
            cc=(),
            bcc=(Address("hidden@example.com"),),
            subject="Hello\r\nBcc: attacker@evil.test",
            body_html="<p>Привіт</p>",
            body_text="Привіт",
            attachments=(OutgoingAttachment("файл.txt", "text/plain", b"data"),),
            in_reply_to="<orig@x>\r\nX-Injected: 1",
            references="<a@x>\n <orig@x>",
        )
    )
    parsed = email.message_from_bytes(raw)
    assert parsed["Subject"] == "Hello  Bcc: attacker@evil.test"
    assert parsed.get_all("Bcc") == ["hidden@example.com"]
    assert parsed["X-Injected"] is None
    assert parsed["In-Reply-To"] == "<orig@x>X-Injected: 1"
    assert parsed["References"] == "<a@x> <orig@x>"
    assert parsed["Message-ID"].endswith("@example.com>")
    types = [part.get_content_type() for part in parsed.walk()]
    assert types == ["multipart/mixed", "multipart/alternative", "text/plain", "text/html",
                     "text/plain"]  # fmt: skip
    attachment = list(parsed.walk())[-1]
    assert attachment.get_filename() == "файл.txt"


# -- OAuth -----------------------------------------------------------------------------------


def test_authorization_url_contains_pkce_state_and_narrow_scope(oauth):
    url = urlparse(oauth.authorization_url(state="st", code_challenge="ch", login_hint="a@b.c"))
    query = parse_qs(url.query)
    assert f"{url.scheme}://{url.netloc}{url.path}" == AUTH_URL
    assert query["state"] == ["st"] and query["code_challenge"] == ["ch"]
    assert query["code_challenge_method"] == ["S256"] and query["access_type"] == ["offline"]
    assert query["redirect_uri"] == ["https://app.test/cb"] and query["response_type"] == ["code"]
    assert query["scope"] == ["https://www.googleapis.com/auth/gmail.modify"]
    assert "client_secret" not in url.query and query["login_hint"] == ["a@b.c"]


@respx.mock
async def test_code_exchange_sends_verifier_and_parses_tokens(oauth):
    route = respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(
            200,
            json={"access_token": "tok-access-xyz", "refresh_token": "tok-refresh-xyz",
                  "expires_in": 3599, "scope": " ".join(SCOPES)},
        )
    )  # fmt: skip
    credentials = await oauth.authenticate(code="the-code", code_verifier="the-verifier")
    sent = parse_qs(route.calls.last.request.content.decode())
    assert sent["code"] == ["the-code"] and sent["code_verifier"] == ["the-verifier"]
    assert sent["grant_type"] == ["authorization_code"]
    assert sent["redirect_uri"] == ["https://app.test/cb"]
    assert credentials.access_token == "tok-access-xyz"
    assert credentials.refresh_token == "tok-refresh-xyz"
    assert timedelta(minutes=55) < credentials.expires_at - datetime.now(UTC) <= timedelta(hours=1)
    assert "tok-" not in repr(credentials)  # secrets never show up in repr / logs


@respx.mock
async def test_code_exchange_failures(oauth):
    respx.post(TOKEN_URL).mock(return_value=httpx.Response(400, json={"error": "invalid_grant"}))
    with pytest.raises(ProviderAuthError):
        await oauth.authenticate(code="bad", code_verifier="v")
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(200, json={"access_token": "at", "scope": " ".join(SCOPES)})
    )
    with pytest.raises(ProviderAuthError, match="refresh token"):
        await oauth.authenticate(code="c", code_verifier="v")
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(
            200, json={"access_token": "at", "refresh_token": "rt", "scope": "openid"}
        )
    )
    with pytest.raises(ProviderAuthError, match="scope"):
        await oauth.authenticate(code="c", code_verifier="v")
    respx.post(TOKEN_URL).mock(return_value=httpx.Response(503))
    with pytest.raises(ProviderUnavailable):
        await oauth.authenticate(code="c", code_verifier="v")
    respx.post(TOKEN_URL).mock(side_effect=httpx.ConnectTimeout("t"))
    with pytest.raises(ProviderUnavailable):
        await oauth.authenticate(code="c", code_verifier="v")


@respx.mock
async def test_refresh_keeps_refresh_token_and_detects_revocation(oauth):
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(200, json={"access_token": "new-at", "expires_in": 100})
    )
    refreshed = await oauth.refresh_credentials(CREDS)
    assert refreshed.access_token == "new-at" and refreshed.refresh_token == "refresh-456"
    respx.post(TOKEN_URL).mock(return_value=httpx.Response(400, json={"error": "invalid_grant"}))
    with pytest.raises(ProviderAuthError):
        await oauth.refresh_credentials(CREDS)
    with pytest.raises(ProviderAuthError):
        await oauth.refresh_credentials(Credentials(access_token="only-access"))


@respx.mock
async def test_revoke_sends_token_in_body_and_identity(oauth):
    route = respx.post(REVOKE_URL).mock(return_value=httpx.Response(200))
    await oauth.revoke_credentials(CREDS)
    request = route.calls.last.request
    assert "refresh-456" not in str(request.url)
    assert parse_qs(request.content.decode())["token"] == ["refresh-456"]
    respx.get(PROFILE_URL).mock(
        return_value=httpx.Response(200, json={"emailAddress": "Me@Example.com"})
    )
    identity = await oauth.fetch_identity(CREDS)
    assert identity.email == "me@example.com"
    respx.get(PROFILE_URL).mock(return_value=httpx.Response(401))
    with pytest.raises(ProviderAuthError):
        await oauth.fetch_identity(CREDS)


# -- provider --------------------------------------------------------------------------------


@respx.mock
async def test_list_messages_first_page_captures_history_cursor(provider):
    respx.get(f"{API}/profile").mock(return_value=httpx.Response(200, json={"historyId": "777"}))
    route = respx.get(f"{API}/messages").mock(
        return_value=httpx.Response(
            200, json={"messages": [{"id": "a"}, {"id": "b"}], "nextPageToken": "p2"}
        )
    )
    page = await provider.list_messages(page_token=None, page_size=50)
    assert page.message_ids == ("a", "b") and page.next_page_token == "p2" and page.cursor == "777"
    request = route.calls.last.request
    assert request.headers["authorization"] == "Bearer access-123"
    assert request.url.params["includeSpamTrash"] == "true"
    second = await provider.list_messages(page_token="p2", page_size=50)
    assert second.cursor is None and route.calls.last.request.url.params["pageToken"] == "p2"


@respx.mock
async def test_get_message_and_thread(provider):
    respx.get(f"{API}/messages/m1").mock(return_value=httpx.Response(200, json=gmail_message()))
    message = await provider.get_message("m1")
    assert message.subject == "Quarterly numbers"
    respx.get(f"{API}/threads/t1").mock(
        return_value=httpx.Response(
            200, json={"messages": [gmail_message("m1"), gmail_message("m2")]}
        )
    )
    assert [m.provider_message_id for m in await provider.get_thread("t1")] == ["m1", "m2"]
    respx.get(f"{API}/messages/gone").mock(return_value=httpx.Response(404))
    with pytest.raises(ProviderNotFound):
        await provider.get_message("gone")


@respx.mock
async def test_draft_ids_are_resolved_once(provider):
    drafts = respx.get(f"{API}/drafts").mock(
        return_value=httpx.Response(200, json={"drafts": [{"id": "d1", "message": {"id": "m1"}}]})
    )
    respx.get(f"{API}/messages/m1").mock(
        return_value=httpx.Response(200, json=gmail_message(labels=("DRAFT",)))
    )
    first = await provider.get_message("m1")
    second = await provider.get_message("m1")
    assert first.provider_draft_id == second.provider_draft_id == "d1"
    assert drafts.call_count == 1


@respx.mock
async def test_history_sync_collects_changes_across_pages(provider):
    pages = [
        {"history": [
            {"messagesAdded": [{"message": {"id": "new1"}}]},
            {"labelsAdded": [{"message": {"id": "lab1"}}],
             "labelsRemoved": [{"message": {"id": "lab2"}}]},
            {"messagesAdded": [{"message": {"id": "temp"}}]},
        ], "nextPageToken": "h2", "historyId": "900"},
        {"history": [{"messagesDeleted": [{"message": {"id": "temp"}}, {"message": {"id": "old"}}]}],
         "historyId": "950"},
    ]  # fmt: skip
    route = respx.get(f"{API}/history").mock(
        side_effect=[httpx.Response(200, json=p) for p in pages]
    )
    changes = await provider.synchronize("800")
    assert changes.upserted_message_ids == ("new1", "lab1", "lab2")
    assert changes.deleted_message_ids == ("temp", "old") and changes.cursor == "950"
    assert route.calls[0].request.url.params["startHistoryId"] == "800"
    assert route.calls[1].request.url.params["pageToken"] == "h2"


@respx.mock
async def test_expired_history_cursor(provider):
    respx.get(f"{API}/history").mock(return_value=httpx.Response(404))
    with pytest.raises(ProviderCursorExpired):
        await provider.synchronize("1")


@respx.mock
async def test_idempotent_calls_retry_with_backoff_then_succeed(http):
    delays: list[float] = []

    async def record(delay: float) -> None:
        delays.append(delay)

    provider = GmailProvider(http, CREDS, sleep=record)
    route = respx.get(f"{API}/labels").mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": "7"}),
            httpx.Response(503),
            httpx.ConnectError("reset"),
            httpx.Response(200, json={"labels": [{"id": "INBOX", "type": "system"}]}),
        ]
    )
    folders = await provider.list_folders()
    assert [f.role for f in folders] == [FolderRole.INBOX]
    assert route.call_count == 4
    assert delays[0] == 7.0 and delays[1] >= 2.0 and delays[2] >= 4.0  # Retry-After, then backoff


@respx.mock
async def test_rate_limit_and_outage_surface_as_typed_errors(provider):
    respx.get(f"{API}/labels").mock(
        return_value=httpx.Response(
            403, json={"error": {"errors": [{"reason": "userRateLimitExceeded"}]}}
        )
    )
    with pytest.raises(ProviderRateLimited):
        await provider.list_folders()
    respx.get(f"{API}/labels").mock(return_value=httpx.Response(500))
    with pytest.raises(ProviderUnavailable):
        await provider.list_folders()
    respx.get(f"{API}/labels").mock(return_value=httpx.Response(401))
    with pytest.raises(ProviderAuthError):
        await provider.list_folders()
    respx.get(f"{API}/labels").mock(
        return_value=httpx.Response(
            403, json={"error": {"errors": [{"reason": "insufficientPermissions"}]}}
        )
    )
    with pytest.raises(ProviderAuthError):
        await provider.list_folders()


def outgoing(**overrides):
    base = {
        "sender": Address("me@example.com"),
        "to": (Address("you@example.com"),),
        "cc": (),
        "bcc": (),
        "subject": "Hi",
        "body_html": "<p>Hi</p>",
        "body_text": "Hi",
    }
    return OutgoingMessage(**{**base, **overrides})


@respx.mock
async def test_send_posts_raw_mime_and_is_never_blindly_retried(provider):
    route = respx.post(f"{API}/messages/send").mock(
        return_value=httpx.Response(200, json={"id": "sent1", "threadId": "t9"})
    )
    sent = await provider.reply_message(outgoing(provider_thread_id="t9", in_reply_to="<o@x>"))
    assert (sent.provider_message_id, sent.provider_thread_id) == ("sent1", "t9")
    body = json.loads(route.calls.last.request.content)
    assert body["threadId"] == "t9"
    parsed = email.message_from_bytes(mapper.b64url_decode(body["raw"]))
    assert parsed["To"] == "you@example.com" and parsed["In-Reply-To"] == "<o@x>"

    route.mock(side_effect=httpx.ReadTimeout("slow"))
    before = route.call_count
    with pytest.raises(ProviderUnavailable):
        await provider.send_message(outgoing())
    # A timeout after submission must not cause a duplicate send: exactly one attempt.
    assert route.call_count == before + 1
    route.mock(return_value=httpx.Response(500))
    with pytest.raises(ProviderUnavailable):
        await provider.send_message(outgoing())
    assert route.call_count == before + 2


@respx.mock
async def test_thread_actions_map_to_gmail_calls(provider):
    modify = respx.post(f"{API}/threads/t1/modify").mock(return_value=httpx.Response(200, json={}))
    trash = respx.post(f"{API}/threads/t1/trash").mock(return_value=httpx.Response(200, json={}))
    untrash = respx.post(f"{API}/threads/t1/untrash").mock(
        return_value=httpx.Response(200, json={})
    )
    expectations = {
        ThreadAction.MARK_READ: {"addLabelIds": [], "removeLabelIds": ["UNREAD"]},
        ThreadAction.MARK_UNREAD: {"addLabelIds": ["UNREAD"], "removeLabelIds": []},
        ThreadAction.STAR: {"addLabelIds": ["STARRED"], "removeLabelIds": []},
        ThreadAction.ARCHIVE: {"addLabelIds": [], "removeLabelIds": ["INBOX"]},
        ThreadAction.SPAM: {"addLabelIds": ["SPAM"], "removeLabelIds": ["INBOX"]},
        ThreadAction.NOT_SPAM: {"addLabelIds": ["INBOX"], "removeLabelIds": ["SPAM"]},
    }
    for action, expected in expectations.items():
        await provider.modify_thread("t1", action)
        assert json.loads(modify.calls.last.request.content) == expected
    await provider.modify_thread("t1", ThreadAction.TRASH)
    assert trash.call_count == 1
    await provider.modify_thread("t1", ThreadAction.RESTORE)
    assert untrash.call_count == 1
    assert json.loads(modify.calls.last.request.content) == {"addLabelIds": ["INBOX"]}
    message_modify = respx.post(f"{API}/messages/m1/modify").mock(
        return_value=httpx.Response(200, json={})
    )
    await provider.modify_message("m1", ThreadAction.UNSTAR)
    assert json.loads(message_modify.calls.last.request.content)["removeLabelIds"] == ["STARRED"]


@respx.mock
async def test_attachment_download_uses_fresh_attachment_id(provider):
    respx.get(f"{API}/messages/m1").mock(return_value=httpx.Response(200, json=gmail_message()))
    blob = respx.get(f"{API}/messages/m1/attachments/att-volatile-1").mock(
        return_value=httpx.Response(200, json={"data": b64(b"%PDF-1.7"), "size": 8})
    )
    assert await provider.get_attachment("m1", "1") == b"%PDF-1.7"
    assert blob.call_count == 1
    with pytest.raises(ProviderNotFound):
        await provider.get_attachment("m1", "99")


@respx.mock
async def test_draft_operations(provider):
    create = respx.post(f"{API}/drafts").mock(
        return_value=httpx.Response(
            200, json={"id": "d1", "message": {"id": "m1", "threadId": "t1"}}
        )
    )
    draft = await provider.create_draft(outgoing())
    assert (draft.provider_draft_id, draft.provider_message_id) == ("d1", "m1")
    assert "raw" in json.loads(create.calls.last.request.content)["message"]
    respx.put(f"{API}/drafts/d1").mock(
        return_value=httpx.Response(
            200, json={"id": "d1", "message": {"id": "m2", "threadId": "t1"}}
        )
    )
    assert (await provider.update_draft("d1", outgoing())).provider_message_id == "m2"
    delete = respx.delete(f"{API}/drafts/d1").mock(return_value=httpx.Response(204))
    await provider.delete_draft("d1")
    assert delete.call_count == 1
    respx.post(f"{API}/drafts/send").mock(
        return_value=httpx.Response(200, json={"id": "m3", "threadId": "t1"})
    )
    assert (await provider.send_draft("d1")).provider_message_id == "m3"


@respx.mock
async def test_search_passes_query(provider):
    route = respx.get(f"{API}/messages").mock(return_value=httpx.Response(200, json={}))
    page = await provider.search_messages("from:alice", page_token=None, page_size=10)
    assert page.message_ids == () and route.calls.last.request.url.params["q"] == "from:alice"


@respx.mock
async def test_background_calls_are_paced_by_quota_cost(http):
    """Gmail allows 6,000 units/min per user and a full message read costs 60 units."""
    import asyncio

    waits: list[float] = []

    async def record(delay: float) -> None:
        waits.append(delay)

    provider = GmailProvider(http, CREDS, sleep=record, units_per_minute=3600)
    respx.get(url__regex=rf"{API}/messages/.*").mock(
        return_value=httpx.Response(200, json=gmail_message())
    )
    respx.get(f"{API}/labels").mock(return_value=httpx.Response(200, json={"labels": []}))
    await asyncio.gather(*(provider.get_message(f"m{i}") for i in range(5)))
    # 60 units at 3,600 units/min = one full read per second: reads start 1 s apart.
    assert [round(w) for w in sorted(waits)] == [1, 2, 3, 4]
    waits.clear()
    await provider.list_folders()  # queued behind the five reads
    await provider.list_folders()  # a 1-unit call reserves almost nothing
    assert round(waits[0]) == 5 and waits[1] - waits[0] < 0.1


@respx.mock
async def test_interactive_calls_are_not_paced_and_fail_fast(http):
    waits: list[float] = []

    async def record(delay: float) -> None:
        waits.append(delay)

    provider = GmailProvider(http, CREDS, sleep=record, max_attempts=2)
    route = respx.get(f"{API}/labels").mock(
        return_value=httpx.Response(
            403, json={"error": {"errors": [{"reason": "rateLimitExceeded"}]}}
        )
    )
    with pytest.raises(ProviderRateLimited):
        await provider.list_folders()
    assert route.call_count == 2 and len(waits) == 1
