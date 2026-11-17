"""Outlook adapter against a mocked Microsoft Graph (respx). No real network."""

from __future__ import annotations

import base64
import json
from collections.abc import Callable
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
    ProviderError,
    ProviderKind,
    ProviderNotFound,
    ProviderRateLimited,
    ProviderUnavailable,
    ProviderUnsupported,
    ThreadAction,
)
from app.integrations.email_providers.outlook import mapper
from app.integrations.email_providers.outlook.oauth import (
    PROFILE_URL,
    SCOPES,
    MicrosoftOAuthClient,
    authorize_url,
    token_url,
)
from app.integrations.email_providers.outlook.provider import (
    API,
    INLINE_ATTACHMENT_LIMIT,
    OUTLOOK_CAPABILITIES,
    OutlookProvider,
)
from app.integrations.email_providers.registry import DefaultProviderRegistry
from tests.conftest import make_settings

CREDS = Credentials(access_token="access-123", refresh_token="refresh-456")
TOKEN_URL = token_url("common")
ROLES = {
    "F-INBOX": FolderRole.INBOX,
    "F-SENT": FolderRole.SENT,
    "F-DRAFTS": FolderRole.DRAFTS,
    "F-TRASH": FolderRole.TRASH,
    "F-JUNK": FolderRole.SPAM,
    "F-ARCHIVE": FolderRole.ARCHIVE,
}
WELL_KNOWN_IDS = {
    "inbox": "F-INBOX",
    "sentitems": "F-SENT",
    "drafts": "F-DRAFTS",
    "deleteditems": "F-TRASH",
    "junkemail": "F-JUNK",
    "archive": "F-ARCHIVE",
}
Handler = Callable[[httpx.Request], httpx.Response]


def graph_message(message_id="AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0AmsgId1", **extra):
    """Shape of ``GET /me/messages/{id}`` with the fields the adapter selects."""
    return {
        "@odata.etag": 'W/"CQAAABYAAAARn2vdzPFjSbaPPxzjlzOTAAASsKZz"',
        "id": message_id,
        "conversationId": "AAQkAGM2conv1=",
        "subject": "Quarterly numbers",
        "bodyPreview": "Hello snippet",
        "body": {"contentType": "html", "content": "<html><body><p>HTML <b>body</b></p></body></html>"},
        "from": {"emailAddress": {"name": "Alice Sender", "address": "Alice@Example.com"}},
        "sender": {"emailAddress": {"name": "Alice Sender", "address": "Alice@Example.com"}},
        "toRecipients": [
            {"emailAddress": {"name": "Bob", "address": "bob@example.com"}},
            {"emailAddress": {"name": "carol@example.com", "address": "carol@example.com"}},
        ],
        "ccRecipients": [
            {"emailAddress": {"name": "Broken", "address": "not-an-address"}},
            {"emailAddress": {"name": "Dave", "address": "dave@example.com"}},
        ],
        "bccRecipients": [],
        "replyTo": [{"emailAddress": {"name": "Replies", "address": "replies@example.com"}}],
        "receivedDateTime": "2026-01-01T00:00:00Z",
        "sentDateTime": "2025-12-31T23:59:58Z",
        "createdDateTime": "2026-01-01T00:00:01Z",
        "isRead": False,
        "isDraft": False,
        "flag": {"flagStatus": "notFlagged"},
        "parentFolderId": "F-INBOX",
        "internetMessageId": "<abc@mail.example.com>",
        "internetMessageHeaders": [
            {"name": "Received", "value": "from mx.example.com"},
            {"name": "In-Reply-To", "value": "<r2@x>"},
            {"name": "References", "value": "<r1@x> <r2@x>"},
        ],
        "hasAttachments": False,
        **extra,
    }  # fmt: skip


ATTACHMENTS = [
    {"@odata.type": "#microsoft.graph.fileAttachment", "id": "AAkALgAAAttach-1=",
     "name": "report.pdf", "contentType": "application/pdf", "size": 2048, "isInline": False},
    {"@odata.type": "#microsoft.graph.fileAttachment", "id": "AAkALgAAAttach-2=",
     "name": "logo.png", "contentType": "image/png", "size": 512, "isInline": True},
]  # fmt: skip


class Graph:
    """Scripted Microsoft Graph. Unmocked calls fail the test loudly."""

    def __init__(self) -> None:
        self.routes: dict[tuple[str, str], Handler | list[httpx.Response] | httpx.Response] = {}
        self.calls: list[httpx.Request] = []
        self.router: respx.MockRouter | None = None
        for name, folder_id in WELL_KNOWN_IDS.items():
            self.on("GET", f"/me/mailFolders/{name}", httpx.Response(200, json={"id": folder_id}))

    def on(self, method: str, path: str, response) -> None:
        self.routes[(method, path)] = response

    def json(self, method: str, path: str, payload, status: int = 200) -> None:
        self.on(method, path, httpx.Response(status, json=payload))

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/v1.0")
        self.calls.append(request)
        handler = self.routes.get((request.method, path))
        if handler is None:
            raise AssertionError(f"unmocked Graph call: {request.method} {path}")
        if isinstance(handler, list):
            return handler.pop(0) if len(handler) > 1 else handler[0]
        if isinstance(handler, httpx.Response):
            return handler
        return handler(request)

    def seen(self, well_known: bool = False) -> list[tuple[str, str]]:
        """(method, path) of every call, without the well-known folder lookups."""
        result = []
        for request in self.calls:
            path = request.url.path.removeprefix("/v1.0")
            if not well_known and path.removeprefix("/me/mailFolders/") in WELL_KNOWN_IDS:
                continue
            result.append((request.method, path))
        return result

    def bodies(self, method: str, path: str) -> list[dict]:
        return [
            json.loads(r.content)
            for r in self.calls
            if r.method == method and r.url.path.removeprefix("/v1.0") == path and r.content
        ]


class Sleeps:
    def __init__(self) -> None:
        self.delays: list[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


@pytest.fixture
async def http():
    async with httpx.AsyncClient() as client:
        yield client


@pytest.fixture
def graph():
    scripted = Graph()
    with respx.mock(assert_all_called=False) as router:
        router.route(host="graph.microsoft.com").mock(side_effect=scripted)
        scripted.router = router
        yield scripted


@pytest.fixture
def sleeps():
    return Sleeps()


@pytest.fixture
def provider(http, sleeps):
    return OutlookProvider(http, CREDS, sleep=sleeps)


@pytest.fixture
def oauth(http):
    return MicrosoftOAuthClient(
        http, client_id="cid", client_secret="csecret", redirect_uri="https://app.test/cb"
    )


def outgoing(**overrides) -> OutgoingMessage:
    values = {
        "sender": Address("me@example.com"),
        "to": (Address("you@example.com", "You"),),
        "cc": (),
        "bcc": (Address("hidden@example.com"),),
        "subject": "Hi",
        "body_html": "<p>Hi</p>",
        "body_text": "Hi",
    }
    return OutgoingMessage(**{**values, **overrides})


# -- mapper ----------------------------------------------------------------------------------


def test_map_message_normalizes_addresses_body_headers_and_attachments():
    message = mapper.map_message(
        graph_message(hasAttachments=True), folder_roles=ROLES, attachments=ATTACHMENTS
    )
    assert message.provider_message_id.startswith("AAkALgAAAAAAHYQDEapm")
    assert message.provider_thread_id == "AAQkAGM2conv1="
    assert message.sender == Address(email="alice@example.com", name="Alice Sender")
    assert message.to == (Address("bob@example.com", "Bob"), Address("carol@example.com"))
    assert [a.email for a in message.cc] == ["dave@example.com"]  # invalid entry dropped
    assert [a.email for a in message.reply_to] == ["replies@example.com"]
    assert message.subject == "Quarterly numbers" and message.snippet == "Hello snippet"
    assert message.body_html and "<b>body</b>" in message.body_html and message.body_text is None
    assert message.sent_at == datetime(2026, 1, 1, tzinfo=UTC)
    assert message.is_read is False and message.is_starred is False and message.is_draft is False
    assert message.roles == frozenset({FolderRole.INBOX}) and message.folder_ids == ()
    assert message.rfc822_message_id == "<abc@mail.example.com>"
    assert message.in_reply_to == "<r2@x>" and message.references == "<r1@x> <r2@x>"
    assert message.provider_draft_id is None
    report, logo = message.attachments
    assert (report.filename, report.mime_type, report.size, report.is_inline) == (
        "report.pdf", "application/pdf", 2048, False,
    )  # fmt: skip
    assert logo.is_inline is True
    # The stored handle is a digest that fits the 64-character column, not the Graph id.
    assert len(report.part_id) == 64 and report.part_id != logo.part_id
    assert report.part_id == mapper.attachment_part_id("AAkALgAAAttach-1=")


def test_map_message_roles_flags_drafts_and_custom_folders():
    sent = mapper.map_message(
        graph_message(parentFolderId="F-SENT", isRead=True, flag={"flagStatus": "flagged"}),
        folder_roles=ROLES,
    )
    assert sent.is_read and sent.is_starred
    assert sent.roles == frozenset({FolderRole.SENT, FolderRole.STARRED})
    completed = mapper.map_message(
        graph_message(flag={"flagStatus": "complete"}), folder_roles=ROLES
    )
    assert completed.is_starred is False
    draft = mapper.map_message(
        graph_message("draft-1", parentFolderId="F-DRAFTS", isDraft=True), folder_roles=ROLES
    )
    assert draft.is_draft and draft.provider_draft_id == "draft-1"
    assert draft.roles == frozenset({FolderRole.DRAFTS})
    custom = mapper.map_message(graph_message(parentFolderId="F-PROJECTS"), folder_roles=ROLES)
    assert custom.roles == frozenset() and custom.folder_ids == ("F-PROJECTS",)
    for role_id, role in (("F-TRASH", FolderRole.TRASH), ("F-JUNK", FolderRole.SPAM),
                          ("F-ARCHIVE", FolderRole.ARCHIVE)):  # fmt: skip
        mapped = mapper.map_message(graph_message(parentFolderId=role_id), folder_roles=ROLES)
        assert mapped.roles == frozenset({role})


def test_map_message_tolerates_minimal_and_text_payloads():
    minimal = mapper.map_message({"id": "x"}, folder_roles={})
    assert minimal.provider_thread_id == "x" and minimal.sender is None and minimal.subject == ""
    assert minimal.sent_at == datetime.fromtimestamp(0, tz=UTC) and minimal.roles == frozenset()
    text = mapper.map_message(
        graph_message(body={"contentType": "text", "content": "Plain"}, receivedDateTime="junk"),
        folder_roles=ROLES,
    )
    assert text.body_text == "Plain" and text.body_html is None
    assert text.sent_at == datetime(2025, 12, 31, 23, 59, 58, tzinfo=UTC)  # falls back to sent
    assert mapper.needs_attachment_lookup(graph_message()) is False
    assert mapper.needs_attachment_lookup(graph_message(hasAttachments=True)) is True
    inline_only = graph_message(body={"contentType": "html", "content": '<img src="cid:x">'})
    assert mapper.needs_attachment_lookup(inline_only) is True


def test_map_folders_names_system_folders_and_builds_paths():
    folders = mapper.map_folders(
        [
            {"id": "F-PROJECTS", "displayName": "Projects", "parentFolderId": "root"},
            {"id": "F-SENT", "displayName": "Надіслані", "parentFolderId": "root"},
            {"id": "F-INBOX", "displayName": "Вхідні", "parentFolderId": "root"},
            {"id": "F-2026", "displayName": "2026/Q1", "parentFolderId": "F-PROJECTS"},
        ],
        ROLES,
    )
    assert [(f.provider_folder_id, f.name, f.role) for f in folders] == [
        ("F-INBOX", "Inbox", FolderRole.INBOX),
        ("F-SENT", "Sent", FolderRole.SENT),
        ("F-PROJECTS", "Projects", FolderRole.CUSTOM),
        ("F-2026", "Projects/2026-Q1", FolderRole.CUSTOM),
    ]


def test_build_message_and_attachment_payloads():
    payload = mapper.build_message(
        outgoing(subject="Hello\r\nBcc: attacker@evil.test", body_html="<p>Привіт</p>")
    )
    assert payload == {
        "subject": "Hello  Bcc: attacker@evil.test",
        "body": {"contentType": "html", "content": "<p>Привіт</p>"},
        "toRecipients": [{"emailAddress": {"address": "you@example.com", "name": "You"}}],
        "ccRecipients": [],
        "bccRecipients": [{"emailAddress": {"address": "hidden@example.com"}}],
    }
    attachment = mapper.build_file_attachment(OutgoingAttachment("файл.txt", "text/plain", b"data"))
    assert attachment == {
        "@odata.type": "#microsoft.graph.fileAttachment",
        "name": "файл.txt",
        "contentType": "text/plain",
        "contentBytes": base64.b64encode(b"data").decode(),
    }


# -- OAuth -----------------------------------------------------------------------------------


def test_authorization_url_contains_pkce_state_and_narrow_scope(oauth, http):
    url = urlparse(oauth.authorization_url(state="st", code_challenge="ch"))
    query = parse_qs(url.query)
    assert f"{url.scheme}://{url.netloc}{url.path}" == (
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    )
    assert query["client_id"] == ["cid"] and query["response_type"] == ["code"]
    assert query["response_mode"] == ["query"] and query["state"] == ["st"]
    assert query["code_challenge"] == ["ch"] and query["code_challenge_method"] == ["S256"]
    assert query["redirect_uri"] == ["https://app.test/cb"]
    assert query["scope"][0].split() == [
        "offline_access",
        "https://graph.microsoft.com/Mail.ReadWrite",
        "https://graph.microsoft.com/Mail.Send",
        "https://graph.microsoft.com/User.Read",
    ]
    assert query["prompt"] == ["select_account"] and "login_hint" not in query
    assert "client_secret" not in url.query and "csecret" not in url.query
    hinted = parse_qs(
        urlparse(oauth.authorization_url(state="s", code_challenge="c", login_hint="a@b.c")).query
    )
    assert hinted["login_hint"] == ["a@b.c"] and "prompt" not in hinted
    tenant = MicrosoftOAuthClient(
        http, client_id="cid", client_secret="x", redirect_uri="https://app.test/cb",
        tenant="contoso.onmicrosoft.com",
    )  # fmt: skip
    assert tenant.authorization_url(state="s", code_challenge="c").startswith(
        "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize?"
    )
    assert authorize_url("a/b") == "https://login.microsoftonline.com/a%2Fb/oauth2/v2.0/authorize"


@respx.mock
async def test_code_exchange_sends_verifier_and_parses_tokens(oauth):
    route = respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(
            200,
            json={"token_type": "Bearer", "access_token": "tok-access-xyz",
                  "refresh_token": "tok-refresh-xyz", "expires_in": 3599,
                  "scope": "Mail.ReadWrite Mail.Send User.Read"},
        )
    )  # fmt: skip
    credentials = await oauth.authenticate(code="the-code", code_verifier="the-verifier")
    sent = parse_qs(route.calls.last.request.content.decode())
    assert sent["code"] == ["the-code"] and sent["code_verifier"] == ["the-verifier"]
    assert sent["grant_type"] == ["authorization_code"]
    assert sent["redirect_uri"] == ["https://app.test/cb"]
    assert sent["client_id"] == ["cid"] and sent["client_secret"] == ["csecret"]
    assert "csecret" not in str(route.calls.last.request.url)
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
        return_value=httpx.Response(200, json={"access_token": "at", "scope": "Mail.ReadWrite"})
    )
    with pytest.raises(ProviderAuthError, match="refresh token"):
        await oauth.authenticate(code="c", code_verifier="v")
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(
            200, json={"access_token": "at", "refresh_token": "rt", "scope": "User.Read openid"}
        )
    )
    with pytest.raises(ProviderAuthError, match="scope"):
        await oauth.authenticate(code="c", code_verifier="v")
    # Fully qualified, differently cased scope names are the same grant.
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(
            200,
            json={"access_token": "at", "refresh_token": "rt",
                  "scope": "https://graph.microsoft.com/mail.readwrite "
                           "https://graph.microsoft.com/Mail.Send"},
        )
    )  # fmt: skip
    assert (await oauth.authenticate(code="c", code_verifier="v")).refresh_token == "rt"
    respx.post(TOKEN_URL).mock(return_value=httpx.Response(503))
    with pytest.raises(ProviderUnavailable):
        await oauth.authenticate(code="c", code_verifier="v")
    respx.post(TOKEN_URL).mock(side_effect=httpx.ConnectTimeout("t"))
    with pytest.raises(ProviderUnavailable):
        await oauth.authenticate(code="c", code_verifier="v")


@respx.mock
async def test_refresh_rotates_refresh_token_and_detects_revocation(oauth):
    route = respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(
            200, json={"access_token": "new-at", "refresh_token": "rotated-rt", "expires_in": 100}
        )
    )
    refreshed = await oauth.refresh_credentials(CREDS)
    sent = parse_qs(route.calls.last.request.content.decode())
    assert sent["grant_type"] == ["refresh_token"] and sent["refresh_token"] == ["refresh-456"]
    assert refreshed.access_token == "new-at" and refreshed.refresh_token == "rotated-rt"
    # No new refresh token in the response: the current one stays valid.
    respx.post(TOKEN_URL).mock(return_value=httpx.Response(200, json={"access_token": "at2"}))
    assert (await oauth.refresh_credentials(CREDS)).refresh_token == "refresh-456"
    for code in ("invalid_grant", "interaction_required"):
        respx.post(TOKEN_URL).mock(return_value=httpx.Response(400, json={"error": code}))
        with pytest.raises(ProviderAuthError):
            await oauth.refresh_credentials(CREDS)
    with pytest.raises(ProviderAuthError):
        await oauth.refresh_credentials(Credentials(access_token="only-access"))


@respx.mock
async def test_operator_errors_do_not_look_like_a_revoked_grant(oauth):
    # An expired application secret must not push every mailbox into "needs reconnect".
    respx.post(TOKEN_URL).mock(return_value=httpx.Response(401, json={"error": "invalid_client"}))
    with pytest.raises(ProviderError) as caught:
        await oauth.refresh_credentials(CREDS)
    assert not isinstance(caught.value, ProviderAuthError)
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(400, json={"error": "temporarily_unavailable"})
    )
    with pytest.raises(ProviderUnavailable):
        await oauth.refresh_credentials(CREDS)


@respx.mock
async def test_revoke_is_a_documented_noop_and_identity(oauth):
    await oauth.revoke_credentials(CREDS)
    assert len(respx.calls) == 0  # Microsoft has no token revocation endpoint
    route = respx.get(PROFILE_URL).mock(
        return_value=httpx.Response(
            200, json={"id": "user-guid-1", "mail": "Me@Example.com", "userPrincipalName": "x@y.z"}
        )
    )
    identity = await oauth.fetch_identity(CREDS)
    assert identity.email == "me@example.com" and identity.subject == "user-guid-1"
    request = route.calls.last.request
    assert request.headers["authorization"] == "Bearer access-123"
    assert request.url.params["$select"] == "id,mail,userPrincipalName"
    respx.get(PROFILE_URL).mock(
        return_value=httpx.Response(
            200, json={"id": "u2", "mail": None, "userPrincipalName": "Person@Outlook.com"}
        )
    )
    assert (await oauth.fetch_identity(CREDS)).email == "person@outlook.com"
    respx.get(PROFILE_URL).mock(
        return_value=httpx.Response(
            200, json={"id": "u3", "mail": None, "userPrincipalName": "guest_x.com#EXT#@t.com"}
        )
    )
    with pytest.raises(ProviderError):
        await oauth.fetch_identity(CREDS)
    respx.get(PROFILE_URL).mock(return_value=httpx.Response(401))
    with pytest.raises(ProviderAuthError):
        await oauth.fetch_identity(CREDS)


def test_scopes_are_the_narrowest_set():
    assert SCOPES == (
        "offline_access",
        "https://graph.microsoft.com/Mail.ReadWrite",
        "https://graph.microsoft.com/Mail.Send",
        "https://graph.microsoft.com/User.Read",
    )


# -- provider: reading -----------------------------------------------------------------------


async def test_list_messages_first_page_captures_cursor_and_pages(provider, graph):
    graph.json(
        "GET",
        "/me/messages",
        {"value": [{"id": "a"}, {"id": "b"}],
         "@odata.nextLink": f"{API}/me/messages?%24select=id&%24top=50&%24skip=50"},
    )  # fmt: skip
    before = datetime.now(UTC)
    page = await provider.list_messages(page_token=None, page_size=50)
    assert page.message_ids == ("a", "b")
    assert page.next_page_token == "/me/messages?%24select=id&%24top=50&%24skip=50"
    cursor = json.loads(page.cursor)
    assert cursor["v"] == 1 and cursor["f"] == {}
    assert before <= datetime.fromisoformat(cursor["since"]) <= datetime.now(UTC)
    request = graph.calls[-1]
    assert request.headers["authorization"] == "Bearer access-123"
    assert request.headers["prefer"] == 'IdType="ImmutableId"'
    assert request.url.params["$select"] == "id" and request.url.params["$top"] == "50"
    assert request.url.params["$orderby"] == "receivedDateTime desc"
    graph.json("GET", "/me/messages", {"value": [{"id": "c"}]})
    second = await provider.list_messages(page_token=page.next_page_token, page_size=50)
    assert second.message_ids == ("c",) and second.cursor is None
    assert second.next_page_token is None
    assert graph.calls[-1].url.params["$skip"] == "50"  # the next link is applied whole
    assert graph.seen() == [("GET", "/me/messages")] * 2


async def test_page_tokens_can_only_point_at_graph(provider, graph):
    graph.json(
        "GET", "/me/messages", {"value": [], "@odata.nextLink": "https://evil.test/me/messages"}
    )
    page = await provider.list_messages(page_token=None, page_size=5000)
    assert page.next_page_token is None  # a foreign link is never stored
    assert graph.calls[-1].url.params["$top"] == "1000"  # clamped to the documented maximum
    with pytest.raises(ProviderError):
        await provider.list_messages(page_token="https://evil.test/x", page_size=10)
    assert all(c.url.host == "graph.microsoft.com" for c in graph.calls)


async def test_search_messages(provider, graph):
    graph.json("GET", "/me/messages", {"value": [{"id": "s1"}]})
    page = await provider.search_messages('quarterly "numbers"', page_token=None, page_size=20)
    assert page.message_ids == ("s1",) and page.cursor is None
    params = graph.calls[-1].url.params
    assert params["$search"] == '"quarterly  numbers"' and "$orderby" not in params


async def test_get_message_fetches_attachment_metadata_only_when_needed(provider, graph):
    graph.json("GET", "/me/messages/m1", graph_message("m1"))
    message = await provider.get_message("m1")
    assert message.subject == "Quarterly numbers" and message.roles == {FolderRole.INBOX}
    assert graph.seen() == [("GET", "/me/messages/m1")]
    assert "internetMessageHeaders" in graph.calls[0].url.params["$select"]
    graph.json("GET", "/me/messages/m2", graph_message("m2", hasAttachments=True))
    graph.json("GET", "/me/messages/m2/attachments", {"value": ATTACHMENTS})
    with_files = await provider.get_message("m2")
    assert [a.filename for a in with_files.attachments] == ["report.pdf", "logo.png"]
    listing = graph.calls[-1]
    assert listing.url.params["$select"] == "id,name,contentType,size,isInline"  # no content
    # Well-known folders were resolved once for the whole session.
    lookups = [c for c in graph.seen(well_known=True) if c[1].split("/")[-1] in WELL_KNOWN_IDS]
    assert len(lookups) == 6
    graph.on("GET", "/me/messages/gone", httpx.Response(404, json={"error": {"code": "ErrorItemNotFound"}}))  # fmt: skip
    with pytest.raises(ProviderNotFound):
        await provider.get_message("gone")


async def test_mailbox_without_archive_folder(provider, graph):
    graph.on("GET", "/me/mailFolders/archive", httpx.Response(404))
    graph.json("GET", "/me/messages/m1", graph_message("m1", parentFolderId="F-ARCHIVE"))
    message = await provider.get_message("m1")
    assert message.roles == frozenset() and message.folder_ids == ("F-ARCHIVE",)


async def test_message_ids_are_url_encoded(provider, graph):
    graph.json("GET", "/me/messages/AAMk/with+odd=", graph_message("AAMk/with+odd="))
    await provider.get_message("AAMk/with+odd=")
    assert graph.calls[0].url.raw_path.startswith(b"/v1.0/me/messages/AAMk%2Fwith%2Bodd%3D?")


async def test_get_thread_filters_by_conversation_and_sorts(provider, graph):
    graph.json(
        "GET",
        "/me/messages",
        {"value": [graph_message("late", receivedDateTime="2026-01-02T00:00:00Z"),
                   graph_message("early", receivedDateTime="2026-01-01T00:00:00Z")]},
    )  # fmt: skip
    messages = await provider.get_thread("conv'1")
    assert [m.provider_message_id for m in messages] == ["early", "late"]
    params = graph.calls[0].url.params
    assert params["$filter"] == "conversationId eq 'conv''1'" and "$orderby" not in params


async def test_list_folders_walks_children(provider, graph):
    graph.json(
        "GET",
        "/me/mailFolders",
        {"value": [
            {"id": "F-INBOX", "displayName": "Inbox", "parentFolderId": "root", "childFolderCount": 1},
            {"id": "F-TRASH", "displayName": "Deleted Items", "parentFolderId": "root", "childFolderCount": 0},
            {"id": "F-PROJECTS", "displayName": "Projects", "parentFolderId": "root", "childFolderCount": 0},
        ]},
    )  # fmt: skip
    graph.json(
        "GET",
        "/me/mailFolders/F-INBOX/childFolders",
        {"value": [{"id": "F-SUB", "displayName": "Receipts", "parentFolderId": "F-INBOX",
                    "childFolderCount": 0}]},
    )  # fmt: skip
    folders = await provider.list_folders()
    assert [(f.provider_folder_id, f.name, f.role) for f in folders] == [
        ("F-INBOX", "Inbox", FolderRole.INBOX),
        ("F-TRASH", "Trash", FolderRole.TRASH),
        ("F-PROJECTS", "Projects", FolderRole.CUSTOM),
        ("F-SUB", "Inbox/Receipts", FolderRole.CUSTOM),
    ]


async def test_get_attachment_resolves_the_digest_and_downloads_raw_bytes(provider, graph):
    graph.json("GET", "/me/messages/m1/attachments", {"value": ATTACHMENTS})
    graph.on(
        "GET", "/me/messages/m1/attachments/AAkALgAAAttach-2=/$value",
        httpx.Response(200, content=b"\x89PNG-bytes"),
    )  # fmt: skip
    part_id = mapper.attachment_part_id("AAkALgAAAttach-2=")
    assert await provider.get_attachment("m1", part_id) == b"\x89PNG-bytes"
    with pytest.raises(ProviderNotFound):
        await provider.get_attachment("m1", "0" * 64)


# -- provider: incremental synchronization ---------------------------------------------------

FOLDERS = {"value": [
    {"id": "F-INBOX", "displayName": "Inbox", "parentFolderId": "root", "childFolderCount": 0},
    {"id": "F-TRASH", "displayName": "Deleted Items", "parentFolderId": "root", "childFolderCount": 0},
]}  # fmt: skip
SINCE = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)


def cursor_of(folders: dict | None = None, index: int = 0) -> str:
    return json.dumps({"v": 1, "since": SINCE.isoformat(), "f": folders or {}, "i": index})


def delta(path: str, pages: dict[str, dict]) -> tuple[str, str, Handler]:
    """Route for a folder's delta endpoint that answers by state token."""

    def handler(request: httpx.Request) -> httpx.Response:
        params = request.url.params
        token = params.get("$skiptoken") or params.get("$deltatoken") or "initial"
        return httpx.Response(200, json=pages[token])

    return ("GET", path, handler)


INBOX_DELTA = "/me/mailFolders/F-INBOX/messages/delta"
TRASH_DELTA = "/me/mailFolders/F-TRASH/messages/delta"


async def test_first_synchronize_primes_every_folder_across_pages(provider, graph):
    graph.json("GET", "/me/mailFolders", FOLDERS)
    graph.on(*delta(INBOX_DELTA, {
        "initial": {
            "value": [
                {"id": "old-1", "lastModifiedDateTime": "2026-02-01T00:00:00Z"},
                {"id": "new-1", "lastModifiedDateTime": "2026-03-01T12:30:00Z"},
            ],
            "@odata.nextLink": f"{API}{INBOX_DELTA}?$skiptoken=p2",
        },
        "p2": {
            "value": [
                {"id": "old-2", "lastModifiedDateTime": "2026-01-15T00:00:00Z"},
                {"id": "skewed", "lastModifiedDateTime": "2026-03-01T11:57:00Z"},
            ],
            "@odata.deltaLink": f"{API}{INBOX_DELTA}?$deltatoken=inbox-1",
        },
    }))  # fmt: skip
    graph.on(*delta(TRASH_DELTA, {
        "initial": {"value": [], "@odata.deltaLink": f"{API}{TRASH_DELTA}?$deltatoken=trash-1"},
    }))  # fmt: skip
    changes = await provider.synchronize(cursor_of())
    # Only what changed since the cursor was created is reported; the backfill owns the rest.
    assert changes.upserted_message_ids == ("new-1", "skewed") and changes.deleted_message_ids == ()
    state = json.loads(changes.cursor)
    assert state["since"] == SINCE.isoformat() and state["i"] == 0
    assert state["f"] == {
        "F-INBOX": {"l": f"{INBOX_DELTA}?$deltatoken=inbox-1", "p": 0},
        "F-TRASH": {"l": f"{TRASH_DELTA}?$deltatoken=trash-1", "p": 0},
    }
    first = next(c for c in graph.calls if c.url.path.endswith("F-INBOX/messages/delta"))
    assert first.url.params["$select"] == "lastModifiedDateTime"
    assert first.headers["prefer"] == 'IdType="ImmutableId", odata.maxpagesize=200'


async def test_incremental_synchronize_reports_changes_moves_and_deletions(provider, graph):
    graph.json("GET", "/me/mailFolders", FOLDERS)
    graph.on(*delta(INBOX_DELTA, {
        "inbox-1": {
            "value": [
                {"id": "arrived"},
                {"id": "read-flag-changed", "isRead": True},
                {"id": "moved-to-trash", "@removed": {"reason": "deleted"}},
                {"id": "really-gone", "@removed": {"reason": "deleted"}},
                {"id": "created-then-gone"},
            ],
            "@odata.nextLink": f"{API}{INBOX_DELTA}?$skiptoken=inbox-p2",
        },
        "inbox-p2": {
            "value": [{"id": "created-then-gone", "@removed": {"reason": "deleted"}}],
            "@odata.deltaLink": f"{API}{INBOX_DELTA}?$deltatoken=inbox-2",
        },
    }))  # fmt: skip
    graph.on(*delta(TRASH_DELTA, {
        "trash-1": {
            "value": [{"id": "moved-to-trash"}],
            "@odata.deltaLink": f"{API}{TRASH_DELTA}?$deltatoken=trash-2",
        },
    }))  # fmt: skip
    graph.json("GET", "/me/messages/moved-to-trash", {"id": "moved-to-trash"})
    graph.on("GET", "/me/messages/really-gone", httpx.Response(404))
    graph.on("GET", "/me/messages/created-then-gone", httpx.Response(404))
    cursor = cursor_of({
        "F-INBOX": {"l": f"{INBOX_DELTA}?$deltatoken=inbox-1", "p": 0},
        "F-TRASH": {"l": f"{TRASH_DELTA}?$deltatoken=trash-1", "p": 0},
    })  # fmt: skip
    changes = await provider.synchronize(cursor)
    # A message removed from one folder but still in the mailbox was moved, not deleted.
    assert set(changes.upserted_message_ids) == {"arrived", "read-flag-changed", "moved-to-trash"}
    assert set(changes.deleted_message_ids) == {"really-gone", "created-then-gone"}
    state = json.loads(changes.cursor)["f"]
    assert state["F-INBOX"]["l"].endswith("$deltatoken=inbox-2")
    assert state["F-TRASH"]["l"].endswith("$deltatoken=trash-2")
    verifies = [c for c in graph.calls if c.url.path.startswith("/v1.0/me/messages/")]
    assert all(c.url.params["$select"] == "id" for c in verifies) and len(verifies) == 3


async def test_state_links_are_followed_exactly_as_graph_returns_them(provider, graph):
    # Microsoft's own examples answer with a differently spelled path than the one requested.
    odd = "/me/mailfolders('F-INBOX')/messages/delta"
    graph.json("GET", "/me/mailFolders", {"value": FOLDERS["value"][:1]})
    graph.on(*delta(INBOX_DELTA, {
        "inbox-1": {"value": [{"id": "a"}], "@odata.nextLink": f"{API}{odd}?$skiptoken=p2"},
    }))  # fmt: skip
    graph.on(*delta(odd, {
        "p2": {"value": [{"id": "b"}], "@odata.deltaLink": f"{API}{odd}?$deltatoken=inbox-2"},
    }))  # fmt: skip
    changes = await provider.synchronize(
        cursor_of({"F-INBOX": {"l": f"{INBOX_DELTA}?$deltatoken=inbox-1", "p": 0}})
    )
    assert changes.upserted_message_ids == ("a", "b")
    assert json.loads(changes.cursor)["f"]["F-INBOX"]["l"] == f"{odd}?$deltatoken=inbox-2"


async def test_synchronize_is_bounded_and_resumes_from_the_cursor(http, graph, sleeps):
    provider = OutlookProvider(http, CREDS, sleep=sleeps, delta_request_budget=1)
    graph.json("GET", "/me/mailFolders", FOLDERS)
    graph.on(*delta(INBOX_DELTA, {
        "inbox-1": {"value": [{"id": "a"}],
                    "@odata.nextLink": f"{API}{INBOX_DELTA}?$skiptoken=inbox-p2"},
        "inbox-p2": {"value": [{"id": "b"}],
                     "@odata.deltaLink": f"{API}{INBOX_DELTA}?$deltatoken=inbox-2"},
        "inbox-2": {"value": [], "@odata.deltaLink": f"{API}{INBOX_DELTA}?$deltatoken=inbox-2"},
    }))  # fmt: skip
    graph.on(*delta(TRASH_DELTA, {
        "trash-1": {"value": [{"id": "t"}],
                    "@odata.deltaLink": f"{API}{TRASH_DELTA}?$deltatoken=trash-2"},
    }))  # fmt: skip
    cursor = cursor_of({
        "F-INBOX": {"l": f"{INBOX_DELTA}?$deltatoken=inbox-1", "p": 0},
        "F-TRASH": {"l": f"{TRASH_DELTA}?$deltatoken=trash-1", "p": 0},
    })  # fmt: skip
    first = await provider.synchronize(cursor)
    assert first.upserted_message_ids == ("a",)
    state = json.loads(first.cursor)
    assert state["i"] == 0 and state["f"]["F-INBOX"]["l"].endswith("$skiptoken=inbox-p2")
    assert state["f"]["F-TRASH"]["l"].endswith("$deltatoken=trash-1")  # untouched so far
    second = await provider.synchronize(first.cursor)
    assert second.upserted_message_ids == ("b",) and json.loads(second.cursor)["i"] == 1
    third = await provider.synchronize(second.cursor)  # starts at the folder that is due
    assert third.upserted_message_ids == ("t",)
    assert json.loads(third.cursor)["f"]["F-TRASH"]["l"].endswith("$deltatoken=trash-2")


async def test_removals_that_cannot_be_verified_yet_are_replayed(http, graph, sleeps):
    provider = OutlookProvider(http, CREDS, sleep=sleeps, verify_budget=1)
    graph.json("GET", "/me/mailFolders", {"value": FOLDERS["value"][:1]})
    graph.on(*delta(INBOX_DELTA, {
        "inbox-1": {"value": [{"id": "x", "@removed": {"reason": "deleted"}},
                              {"id": "y", "@removed": {"reason": "deleted"}}],
                    "@odata.deltaLink": f"{API}{INBOX_DELTA}?$deltatoken=inbox-2"},
    }))  # fmt: skip
    cursor = cursor_of({"F-INBOX": {"l": f"{INBOX_DELTA}?$deltatoken=inbox-1", "p": 0}})
    changes = await provider.synchronize(cursor)
    assert changes.deleted_message_ids == () and changes.upserted_message_ids == ()
    assert json.loads(changes.cursor)["f"]["F-INBOX"]["l"].endswith("$deltatoken=inbox-1")


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(410, json={"error": {"code": "SyncStateNotFound"}}),
        httpx.Response(400, json={"error": {"code": "syncStateNotFound", "message": "gone"}}),
        httpx.Response(410),
        httpx.Response(404, json={"error": {"code": "ErrorItemNotFound"}}),  # folder deleted
    ],
)
async def test_expired_delta_token_requires_a_full_resync(provider, graph, response):
    graph.json("GET", "/me/mailFolders", FOLDERS)
    graph.on("GET", INBOX_DELTA, response)
    cursor = cursor_of({"F-INBOX": {"l": f"{INBOX_DELTA}?$deltatoken=old", "p": 0}})
    with pytest.raises(ProviderCursorExpired):
        await provider.synchronize(cursor)


async def test_other_delta_failures_are_not_mistaken_for_expiry(provider, graph):
    graph.json("GET", "/me/mailFolders", FOLDERS)
    graph.on("GET", INBOX_DELTA, httpx.Response(400, json={"error": {"code": "BadRequest"}}))
    cursor = cursor_of({"F-INBOX": {"l": f"{INBOX_DELTA}?$deltatoken=t", "p": 0}})
    with pytest.raises(ProviderError) as caught:
        await provider.synchronize(cursor)
    assert not isinstance(caught.value, ProviderCursorExpired)
    graph.on("GET", INBOX_DELTA, httpx.Response(401))
    with pytest.raises(ProviderAuthError):
        await provider.synchronize(cursor)


async def test_unusable_cursors_and_vanished_folders_expire(provider, graph):
    graph.json("GET", "/me/mailFolders", FOLDERS)
    for bad in ("777", "not json", '{"v":2,"since":"2026-01-01T00:00:00+00:00","f":{}}',
                '{"v":1,"since":"never","f":{}}'):  # fmt: skip
        with pytest.raises(ProviderCursorExpired):
            await provider.synchronize(bad)
    # A stored link with an origin of its own is never requested.
    with pytest.raises(ProviderCursorExpired):
        await provider.synchronize(cursor_of({"F-INBOX": {"l": "https://evil.test/delta", "p": 0}}))
    # A tracked folder that no longer exists took its messages with it.
    gone = cursor_of({"F-GONE": {"l": "/me/mailFolders/F-GONE/messages/delta?$deltatoken=t", "p": 0}})  # fmt: skip
    with pytest.raises(ProviderCursorExpired):
        await provider.synchronize(gone)
    assert all("delta" not in path for _, path in graph.seen())


# -- provider: resilience --------------------------------------------------------------------


async def test_throttling_honours_retry_after_then_succeeds(provider, graph, sleeps):
    graph.on("GET", "/me/messages/m1", [
        httpx.Response(429, headers={"Retry-After": "7"},
                       json={"error": {"code": "TooManyRequests"}}),
        httpx.Response(503),
        httpx.Response(200, json=graph_message("m1")),
    ])  # fmt: skip
    assert (await provider.get_message("m1")).provider_message_id == "m1"
    assert sleeps.delays[0] == 7.0 and len(sleeps.delays) == 2 and sleeps.delays[1] >= 1.0


async def test_exhausted_retries_surface_rate_limit_and_outage(provider, graph, sleeps):
    graph.on("GET", "/me/messages/m1", httpx.Response(429, headers={"Retry-After": "12"}))
    with pytest.raises(ProviderRateLimited) as caught:
        await provider.get_message("m1")
    assert caught.value.retry_after == 12.0 and len(sleeps.delays) == 3
    graph.on("GET", "/me/messages/m2", httpx.Response(503))
    with pytest.raises(ProviderUnavailable):
        await provider.get_message("m2")
    graph.on("GET", "/me/messages/m3", httpx.Response(401))
    with pytest.raises(ProviderAuthError):
        await provider.get_message("m3")


async def test_interactive_sessions_fail_fast_and_workers_are_paced(http, graph):
    slept = Sleeps()
    interactive = OutlookProvider(http, CREDS, sleep=slept, max_attempts=2)
    graph.on("GET", "/me/messages/m1", httpx.Response(429))
    with pytest.raises(ProviderRateLimited):
        await interactive.get_message("m1")
    assert len(slept.delays) == 1  # one retry only
    paced_sleeps = Sleeps()
    worker = OutlookProvider(http, CREDS, sleep=paced_sleeps, requests_per_minute=60)
    graph.json("GET", "/me/messages", {"value": []})
    for _ in range(3):
        await worker.list_messages(page_token=None, page_size=10)
    # One request per second: the second and third calls wait for their slot.
    assert len(paced_sleeps.delays) == 2
    assert 0.5 < paced_sleeps.delays[0] <= 1.0 and 1.5 < paced_sleeps.delays[1] <= 2.0


async def test_concurrency_never_exceeds_the_documented_four(http):
    provider = OutlookProvider(http, CREDS, max_concurrency=16)
    assert provider._semaphore._value == 4
    assert OutlookProvider(http, CREDS, max_concurrency=2)._semaphore._value == 2


# -- provider: actions -----------------------------------------------------------------------

THREAD = {"value": [
    {"id": "in-1", "parentFolderId": "F-INBOX"},
    {"id": "sent-1", "parentFolderId": "F-SENT"},
    {"id": "arch-1", "parentFolderId": "F-ARCHIVE"},
    {"id": "trash-1", "parentFolderId": "F-TRASH"},
    {"id": "junk-1", "parentFolderId": "F-JUNK"},
    {"id": "custom-1", "parentFolderId": "F-PROJECTS"},
]}  # fmt: skip
ALL_IDS = ["in-1", "sent-1", "arch-1", "trash-1", "junk-1", "custom-1"]


@pytest.mark.parametrize(
    ("action", "patch"),
    [
        (ThreadAction.MARK_READ, {"isRead": True}),
        (ThreadAction.MARK_UNREAD, {"isRead": False}),
        (ThreadAction.STAR, {"flag": {"flagStatus": "flagged"}}),
        (ThreadAction.UNSTAR, {"flag": {"flagStatus": "notFlagged"}}),
    ],
)
async def test_flag_actions_patch_every_message_of_the_conversation(provider, graph, action, patch):
    graph.json("GET", "/me/messages", THREAD)
    for message_id in ALL_IDS:
        graph.json("PATCH", f"/me/messages/{message_id}", {"id": message_id})
    await provider.modify_thread("conv-1", action)
    assert graph.calls[0].url.params["$filter"] == "conversationId eq 'conv-1'"
    assert sorted(graph.seen()[1:]) == sorted(("PATCH", f"/me/messages/{i}") for i in ALL_IDS)
    for message_id in ALL_IDS:
        assert graph.bodies("PATCH", f"/me/messages/{message_id}") == [patch]


@pytest.mark.parametrize(
    ("action", "destination", "moved"),
    [
        (ThreadAction.ARCHIVE, "archive", ["in-1"]),
        (ThreadAction.UNARCHIVE, "inbox", ["arch-1"]),
        (ThreadAction.TRASH, "deleteditems", ["in-1", "sent-1", "arch-1", "junk-1", "custom-1"]),
        (ThreadAction.RESTORE, "inbox", ["trash-1"]),
        (ThreadAction.SPAM, "junkemail", ["in-1", "arch-1", "custom-1"]),
        (ThreadAction.NOT_SPAM, "inbox", ["junk-1"]),
    ],
)
async def test_folder_actions_move_the_right_messages(provider, graph, action, destination, moved):
    graph.json("GET", "/me/messages", THREAD)
    for message_id in ALL_IDS:
        graph.json("POST", f"/me/messages/{message_id}/move", {"id": message_id}, status=201)
    await provider.modify_thread("conv-1", action)
    assert sorted(graph.seen()[1:]) == sorted(("POST", f"/me/messages/{i}/move") for i in moved)
    for message_id in moved:
        assert graph.bodies("POST", f"/me/messages/{message_id}/move") == [
            {"destinationId": destination}
        ]


async def test_modify_thread_without_messages_is_not_found(provider, graph):
    graph.json("GET", "/me/messages", {"value": []})
    with pytest.raises(ProviderNotFound):
        await provider.modify_thread("conv-x", ThreadAction.MARK_READ)


async def test_modify_and_delete_single_message(provider, graph):
    graph.json("PATCH", "/me/messages/m1", {"id": "m1"})
    await provider.modify_message("m1", ThreadAction.STAR)
    assert graph.seen() == [("PATCH", "/me/messages/m1")]  # no lookups for a flag change
    assert graph.bodies("PATCH", "/me/messages/m1") == [{"flag": {"flagStatus": "flagged"}}]
    graph.calls.clear()
    graph.json("GET", "/me/messages/m1", {"id": "m1", "parentFolderId": "F-INBOX"})
    graph.json("POST", "/me/messages/m1/move", {"id": "m1"}, status=201)
    await provider.modify_message("m1", ThreadAction.ARCHIVE)
    assert graph.bodies("POST", "/me/messages/m1/move") == [{"destinationId": "archive"}]
    graph.calls.clear()
    await provider.delete_message("m1")  # trash, never a permanent delete
    assert graph.seen() == [("POST", "/me/messages/m1/move")]
    assert graph.bodies("POST", "/me/messages/m1/move") == [{"destinationId": "deleteditems"}]


# -- provider: sending and drafts ------------------------------------------------------------


async def test_send_creates_a_draft_then_sends_it(provider, graph):
    graph.json("POST", "/me/messages", {"id": "draft-1", "conversationId": "conv-9"}, status=201)
    graph.on("POST", "/me/messages/draft-1/send", httpx.Response(202))
    sent = await provider.send_message(outgoing())
    # With immutable ids the sent copy keeps the id of the draft it was created from.
    assert (sent.provider_message_id, sent.provider_thread_id) == ("draft-1", "conv-9")
    assert graph.seen() == [("POST", "/me/messages"), ("POST", "/me/messages/draft-1/send")]
    assert graph.bodies("POST", "/me/messages") == [mapper.build_message(outgoing())]
    assert all(c.headers["prefer"] == 'IdType="ImmutableId"' for c in graph.calls)
    assert await provider.forward_message(outgoing()) == sent


async def test_send_is_not_retried_after_an_ambiguous_failure(provider, graph, sleeps):
    graph.json("POST", "/me/messages", {"id": "draft-1", "conversationId": "c"}, status=201)
    attempts = []

    def explode(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        raise httpx.ReadTimeout("did it go out?")

    graph.on("POST", "/me/messages/draft-1/send", explode)
    with pytest.raises(ProviderUnavailable):
        await provider.send_message(outgoing())
    assert len(attempts) == 1 and sleeps.delays == []
    # The draft is left alone: it may already be on its way.
    assert ("DELETE", "/me/messages/draft-1") not in graph.seen()
    attempts.clear()
    graph.on("POST", "/me/messages/draft-1/send", [httpx.Response(503)])
    with pytest.raises(ProviderUnavailable):
        await provider.send_message(outgoing())
    assert graph.seen().count(("POST", "/me/messages/draft-1/send")) == 2  # one per send call


async def test_draft_creation_is_not_retried_and_rejected_send_cleans_up(provider, graph):
    creates = []

    def explode(request: httpx.Request) -> httpx.Response:
        creates.append(request)
        raise httpx.ConnectError("boom")

    graph.on("POST", "/me/messages", explode)
    with pytest.raises(ProviderUnavailable):
        await provider.send_message(outgoing())
    assert len(creates) == 1
    graph.json("POST", "/me/messages", {"id": "draft-2", "conversationId": "c"}, status=201)
    graph.on(
        "POST", "/me/messages/draft-2/send",
        httpx.Response(400, json={"error": {"code": "ErrorInvalidRecipients"}}),
    )  # fmt: skip
    graph.on("DELETE", "/me/messages/draft-2", httpx.Response(204))
    with pytest.raises(ProviderError):
        await provider.send_message(outgoing())
    assert graph.seen()[-1] == ("DELETE", "/me/messages/draft-2")  # definitely not sent


async def test_reply_is_created_from_the_original_to_keep_the_conversation(provider, graph):
    graph.json("GET", "/me/messages", {"value": [{"id": "orig-1"}]})
    graph.json(
        "POST", "/me/messages/orig-1/createReply",
        {"id": "reply-1", "conversationId": "conv-1", "subject": "RE: Quarterly numbers"},
        status=201,
    )  # fmt: skip
    graph.json("PATCH", "/me/messages/reply-1", {"id": "reply-1", "conversationId": "conv-1"})
    graph.on("POST", "/me/messages/reply-1/send", httpx.Response(202))
    message = outgoing(
        subject="Re: Quarterly numbers", provider_thread_id="conv-1",
        in_reply_to="<abc@mail.example.com>", references="<r1@x> <abc@mail.example.com>",
    )  # fmt: skip
    sent = await provider.reply_message(message)
    assert (sent.provider_message_id, sent.provider_thread_id) == ("reply-1", "conv-1")
    assert graph.seen() == [
        ("GET", "/me/messages"),
        ("POST", "/me/messages/orig-1/createReply"),
        ("PATCH", "/me/messages/reply-1"),
        ("POST", "/me/messages/reply-1/send"),
    ]
    assert graph.calls[0].url.params["$filter"] == "internetMessageId eq '<abc@mail.example.com>'"
    assert graph.bodies("POST", "/me/messages/orig-1/createReply") == []  # no request body
    # Our content and recipients replace what createReply pre-filled.
    assert graph.bodies("PATCH", "/me/messages/reply-1") == [mapper.build_message(message)]


async def test_reply_falls_back_to_a_new_message_when_the_original_is_gone(provider, graph):
    graph.json("GET", "/me/messages", {"value": []})
    graph.json("POST", "/me/messages", {"id": "d", "conversationId": "new-conv"}, status=201)
    graph.on("POST", "/me/messages/d/send", httpx.Response(202))
    sent = await provider.reply_message(outgoing(in_reply_to="<missing@x>"))
    assert sent.provider_thread_id == "new-conv"


async def test_small_attachments_are_posted_and_large_ones_use_an_upload_session(provider, graph):
    big = OutgoingAttachment("video.bin", "application/octet-stream",
                             b"x" * (INLINE_ATTACHMENT_LIMIT + 1024 * 1024 + 5))  # fmt: skip
    small = OutgoingAttachment("note.txt", "text/plain", b"hello")
    graph.json("POST", "/me/messages", {"id": "d1", "conversationId": "c"}, status=201)
    graph.json("POST", "/me/messages/d1/attachments", {"id": "att"}, status=201)
    upload_url = "https://outlook.office.com/api/v2.0/Users('u')/Messages('d1')/AttachmentSessions('s')?authtoken=t"  # fmt: skip
    graph.json(
        "POST", "/me/messages/d1/attachments/createUploadSession",
        {"uploadUrl": upload_url, "nextExpectedRanges": ["0-"]}, status=201,
    )  # fmt: skip
    graph.on("POST", "/me/messages/d1/send", httpx.Response(202))
    uploads: list[httpx.Request] = []

    def accept(request: httpx.Request) -> httpx.Response:
        uploads.append(request)
        return httpx.Response(201 if len(uploads) == 2 else 200, json={})

    graph.router.put(host="outlook.office.com").mock(side_effect=accept)
    await provider.send_message(outgoing(attachments=(small, big)))
    assert graph.bodies("POST", "/me/messages/d1/attachments") == [
        mapper.build_file_attachment(small)
    ]
    assert graph.bodies("POST", "/me/messages/d1/attachments/createUploadSession") == [
        {"AttachmentItem": {"attachmentType": "file", "name": "video.bin",
                            "size": len(big.content), "contentType": "application/octet-stream"}}
    ]  # fmt: skip
    total = len(big.content)
    assert [u.headers["content-range"] for u in uploads] == [
        f"bytes 0-{INLINE_ATTACHMENT_LIMIT - 1}/{total}",
        f"bytes {INLINE_ATTACHMENT_LIMIT}-{total - 1}/{total}",
    ]
    assert b"".join(u.content for u in uploads) == big.content
    # The upload URL is pre-authorized: the bearer token must not be sent to it.
    assert all("authorization" not in u.headers for u in uploads)
    assert graph.seen()[-1] == ("POST", "/me/messages/d1/send")


async def test_failed_attachment_discards_the_draft_and_foreign_upload_urls_are_refused(
    provider, graph
):
    graph.json("POST", "/me/messages", {"id": "d1", "conversationId": "c"}, status=201)
    graph.on("POST", "/me/messages/d1/attachments", httpx.Response(413))
    graph.on("DELETE", "/me/messages/d1", httpx.Response(204))
    small = OutgoingAttachment("note.txt", "text/plain", b"hello")
    with pytest.raises(ProviderError):
        await provider.send_message(outgoing(attachments=(small,)))
    assert graph.seen()[-1] == ("DELETE", "/me/messages/d1")
    assert ("POST", "/me/messages/d1/send") not in graph.seen()
    graph.json(
        "POST", "/me/messages/d1/attachments/createUploadSession",
        {"uploadUrl": "https://evil.test/upload"}, status=201,
    )  # fmt: skip
    big = OutgoingAttachment("big.bin", "application/octet-stream", b"x" * INLINE_ATTACHMENT_LIMIT)
    with pytest.raises(ProviderError, match="upload session"):
        await provider.send_message(outgoing(attachments=(big,)))


async def test_draft_lifecycle(provider, graph):
    graph.json("POST", "/me/messages", {"id": "d1", "conversationId": "c1"}, status=201)
    draft = await provider.create_draft(outgoing())
    assert (draft.provider_draft_id, draft.provider_message_id, draft.provider_thread_id) == (
        "d1", "d1", "c1",
    )  # fmt: skip
    graph.json("PATCH", "/me/messages/d1", {"id": "d1", "conversationId": "c1"})
    updated = await provider.update_draft("d1", outgoing(subject="Edited"))
    assert updated == draft  # edited in place: the id does not change
    assert graph.bodies("PATCH", "/me/messages/d1")[0]["subject"] == "Edited"
    graph.json("GET", "/me/messages/d1", {"id": "d1", "conversationId": "c1"})
    graph.on("POST", "/me/messages/d1/send", httpx.Response(202))
    sent = await provider.send_draft("d1")
    assert (sent.provider_message_id, sent.provider_thread_id) == ("d1", "c1")
    graph.on("DELETE", "/me/messages/d1", httpx.Response(204))
    await provider.delete_draft("d1")
    assert graph.seen()[-1] == ("DELETE", "/me/messages/d1")
    graph.on("DELETE", "/me/messages/d1", httpx.Response(404))
    with pytest.raises(ProviderNotFound):
        await provider.delete_draft("d1")


# -- registry --------------------------------------------------------------------------------


async def test_registry_offers_outlook_only_when_configured(http):
    unconfigured = DefaultProviderRegistry(make_settings(), http)
    assert unconfigured.is_available(ProviderKind.OUTLOOK) is False
    assert unconfigured.is_available(ProviderKind.GMAIL) is True
    # IMAP needs no server-side configuration (the user supplies the servers).
    assert unconfigured.is_available(ProviderKind.IMAP) is True
    assert unconfigured.capabilities(ProviderKind.OUTLOOK) is OUTLOOK_CAPABILITIES
    assert OUTLOOK_CAPABILITIES.labels is False and OUTLOOK_CAPABILITIES.incremental_sync is True
    half = DefaultProviderRegistry(make_settings(microsoft_client_id="only-id"), http)
    assert half.is_available(ProviderKind.OUTLOOK) is False
    settings = make_settings(
        microsoft_client_id="ms-id", microsoft_client_secret="ms-secret", microsoft_tenant=" "
    )
    assert settings.microsoft_tenant == "common"
    assert settings.outlook_redirect_uri.endswith("/api/v1/accounts/oauth/outlook/callback")
    registry = DefaultProviderRegistry(settings, http)
    assert registry.is_available(ProviderKind.OUTLOOK) is True
    client = registry.oauth_client(ProviderKind.OUTLOOK)
    assert isinstance(client, MicrosoftOAuthClient)
    assert "client_id=ms-id" in client.authorization_url(state="s", code_challenge="c")
    interactive = registry.provider(ProviderKind.OUTLOOK, CREDS)
    assert isinstance(interactive, OutlookProvider) and interactive._seconds_per_request == 0.0
    worker = DefaultProviderRegistry(settings, http, background=True).provider(
        ProviderKind.OUTLOOK, CREDS
    )
    assert isinstance(worker, OutlookProvider)
    assert worker._seconds_per_request == pytest.approx(0.2)  # 300 requests per minute
    assert worker._semaphore._value == 2  # half of Graph's four concurrent requests
    with pytest.raises(ProviderUnsupported):
        registry.oauth_client(ProviderKind.IMAP)
    with pytest.raises(ProviderUnsupported):
        registry.provider(ProviderKind.IMAP, CREDS)
