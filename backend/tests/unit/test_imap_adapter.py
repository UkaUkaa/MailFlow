"""IMAP adapter: pure helpers, guarded transport (against an in-process TLS server) and the
synchronization algorithm (against a scripted in-memory mailbox)."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from email import message_from_bytes

import pytest

from app.integrations.email_providers.contracts import (
    Address,
    FolderRole,
    MailEndpoint,
    MailSecurity,
    OutgoingAttachment,
    OutgoingMessage,
    ProviderAuthError,
    ProviderCursorExpired,
    ProviderDestinationBlocked,
    ProviderError,
    ProviderNotFound,
    ProviderTlsRequired,
    ProviderUnavailable,
    ProviderUnsupported,
    ServerCredentials,
    ThreadAction,
)
from app.integrations.email_providers.imap import ImapProvider, MailConnector, mime
from app.integrations.email_providers.imap import mailbox as mb
from app.integrations.email_providers.imap.transport import IMAP_PORTS, close_imap, close_smtp
from tests.imap_support import (
    TEST_CA,
    ScriptedServer,
    imap_handler,
    server_tls_context,
    smtp_handler,
)

PUBLIC_IP = "93.184.216.34"
SECRET = "s3cret-pass-word"


def creds(
    host: str = "mail.localhost",
    *,
    imap: MailSecurity = MailSecurity.SSL,
    smtp: MailSecurity = MailSecurity.SSL,
    imap_port: int | None = None,
    smtp_port: int | None = None,
) -> ServerCredentials:
    return ServerCredentials(
        MailEndpoint(host, imap_port or (993 if imap is MailSecurity.SSL else 143), imap),
        MailEndpoint(host, smtp_port or (465 if smtp is MailSecurity.SSL else 587), smtp),
        "user@example.test",
        SECRET,
    )


def resolver(*addresses: str):
    calls: list[str] = []

    async def resolve(host: str, port: int) -> list[str]:
        calls.append(host)
        return list(addresses)

    resolve.calls = calls  # type: ignore[attr-defined]
    return resolve


# -- credentials -------------------------------------------------------------------------------


def test_password_and_username_never_appear_in_repr():
    credentials = creds()
    for text in (repr(credentials), str(credentials), f"{credentials!r}"):
        assert SECRET not in text and "user@example.test" not in text
    assert "mail.localhost" in repr(credentials)  # hosts are not secret in memory


# -- MIME parsing ------------------------------------------------------------------------------

ALTERNATIVE = (
    b"From: =?UTF-8?B?0J7Qu9C10L3QsA==?= <olena@example.org>\r\n"
    b"To: Me <me@example.test>, other@example.test\r\n"
    b"Cc: =?iso-8859-1?Q?J=F6rg?= <jorg@example.org>\r\n"
    b"Reply-To: reply@example.org\r\n"
    b"Subject: =?UTF-8?B?0J/RgNC40LLRltGCLA==?= =?UTF-8?Q?_=D1=81=D0=B2=D1=96=D1=82?=\r\n"
    b"Message-ID: <abc@example.org>\r\n"
    b"In-Reply-To: <prev@example.org>\r\n"
    b"References: <first@example.org>\r\n <prev@example.org>\r\n"
    b"Date: Mon, 16 Nov 2026 12:30:00 +0200\r\n"
    b"MIME-Version: 1.0\r\n"
    b'Content-Type: multipart/alternative; boundary="b1"\r\n\r\n'
    b"--b1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlain   text\r\nbody\r\n"
    b"--b1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>HTML <b>body</b></p>\r\n"
    b"--b1--\r\n"
)

MIXED = (
    b"From: a@example.org\r\nTo: me@example.test\r\nSubject: files\r\n"
    b'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="m"\r\n\r\n'
    b'--m\r\nContent-Type: multipart/related; boundary="r"\r\n\r\n'
    b'--r\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p><img src="cid:logo@x"></p>\r\n'
    b"--r\r\nContent-Type: image/png\r\nContent-ID: <logo@x>\r\n"
    b"Content-Disposition: inline\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n"
    b"--r--\r\n"
    b"--m\r\nContent-Type: application/pdf\r\n"
    b"Content-Disposition: attachment; filename*=UTF-8''%D0%B7%D0%B2%D1%96%D1%82.pdf\r\n"
    b"Content-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQ=\r\n"
    b"--m\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; "
    b'filename="notes.txt"\r\n\r\nattached text\r\n'
    b"--m\r\nContent-Type: message/rfc822\r\n\r\n"
    b"From: inner@example.org\r\nSubject: inner\r\n\r\ninner body\r\n"
    b"--m--\r\n"
)


def test_parses_multipart_alternative_with_rfc2047_headers():
    parsed = mime.parse_message(ALTERNATIVE)
    assert parsed.subject == "Привіт, світ"
    assert parsed.sender == Address("olena@example.org", "Олена")
    assert parsed.to == (Address("me@example.test", "Me"), Address("other@example.test"))
    assert parsed.cc == (Address("jorg@example.org", "Jörg"),)
    assert parsed.reply_to == (Address("reply@example.org"),)
    assert parsed.body_text.strip().splitlines()[0] == "Plain   text"
    assert parsed.body_html.strip() == "<p>HTML <b>body</b></p>"
    assert parsed.snippet == "Plain text body"
    assert parsed.attachments == ()
    assert parsed.rfc822_message_id == "<abc@example.org>"
    assert parsed.in_reply_to == "<prev@example.org>"
    assert parsed.references == "<first@example.org> <prev@example.org>"
    assert parsed.date == datetime(2026, 11, 16, 10, 30, tzinfo=UTC)


def test_parses_attachments_inline_images_and_embedded_messages():
    parsed = mime.parse_message(MIXED)
    assert parsed.body_html.strip() == '<p><img src="cid:logo@x"></p>'
    assert parsed.body_text is None
    by_id = {a.part_id: a for a in parsed.attachments}
    assert set(by_id) == {"1.2", "2", "3", "4"}
    assert by_id["1.2"].is_inline and by_id["1.2"].content_id == "logo@x"
    assert by_id["1.2"].mime_type == "image/png"
    assert by_id["2"].filename == "звіт.pdf" and not by_id["2"].is_inline
    assert by_id["2"].size == len(b"%PDF-1.4")
    assert by_id["3"].filename == "notes.txt"  # a text part with a file name is not the body
    assert by_id["4"].mime_type == "message/rfc822" and by_id["4"].filename == "message.eml"


def test_attachment_bytes_are_addressed_by_a_stable_part_id():
    assert mime.extract_part(MIXED, "2") == b"%PDF-1.4"
    assert mime.extract_part(MIXED, "1.2") == b"\x89PNG\r\n\x1a\n"
    assert mime.extract_part(MIXED, "3").strip() == b"attached text"
    assert b"inner body" in mime.extract_part(MIXED, "4")
    assert mime.extract_part(MIXED, "9") is None
    # Same structure parsed twice gives the same ids.
    assert [a.part_id for a in mime.parse_message(MIXED).attachments] == ["1.2", "2", "3", "4"]


@pytest.mark.parametrize(
    "charset,payload,expected",
    [
        ("koi8-u", "Привіт".encode("koi8-u"), "Привіт"),
        ("windows-1251", "Привіт".encode("cp1251"), "Привіт"),
        ("iso-8859-2", "Zażółć".encode("iso-8859-2"), "Zażółć"),
        ("x-unknown-charset", b"plain ascii", "plain ascii"),
        ("utf-8", b"bad \xff byte", "bad � byte"),
    ],
)
def test_odd_and_unknown_charsets_are_decoded_without_raising(charset, payload, expected):
    raw = (
        f"From: a@example.org\r\nSubject: x\r\nContent-Type: text/plain; charset={charset}\r\n"
        "Content-Transfer-Encoding: 8bit\r\n\r\n"
    ).encode() + payload
    assert mime.parse_message(raw).body_text.strip() == expected


@pytest.mark.parametrize(
    "raw",
    [
        b"",
        b"\x00\xff\xfe garbage without headers",
        b"Subject: only a header",
        b"From: <<<>>>\r\nTo: ;;;,,@\r\nDate: not a date\r\nSubject: =?utf-8?b?!!!?=\r\n\r\nbody",
        b'Content-Type: multipart/mixed; boundary="never-closed"\r\n\r\n--never-closed\r\n'
        b"Content-Type: text/plain\r\n\r\ntruncated",
        b"Content-Type: multipart/mixed\r\n\r\nno boundary parameter at all",
        b"Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n!!!not base64!!!",
        b"From: a@b.c\r\nContent-Type: text/html; charset=utf-8\r\n\r\n" + b"<p>" * 100_000,
    ],
)
def test_malformed_messages_never_raise(raw):
    parsed = mime.parse_message(raw)
    assert isinstance(parsed.subject, str)
    assert parsed.date is None or parsed.date.tzinfo is not None
    assert all("@" in a.email for a in (*parsed.to, *parsed.cc))
    assert mime.extract_part(raw, "7") is None


def test_header_addresses_with_injected_newlines_are_dropped():
    raw = b'From: ok@example.org\r\nTo: "x" <evil@example.org\r\n RCPT TO:<victim@example.org>>\r\n\r\nb'
    parsed = mime.parse_message(raw)
    assert all(" " not in a.email and "\n" not in a.email for a in parsed.to)


def test_bodies_are_capped():
    raw = b"Content-Type: text/plain; charset=utf-8\r\n\r\n" + b"a" * (mime.MAX_BODY_BYTES + 5000)
    assert len(mime.parse_message(raw).body_text) == mime.MAX_BODY_BYTES


def test_implausible_dates_fall_back_to_the_arrival_time():
    arrival = datetime(2026, 11, 17, 12, tzinfo=UTC)
    assert mime.effective_date(None, arrival) == arrival
    assert mime.effective_date(datetime(2031, 1, 1, tzinfo=UTC), arrival) == arrival
    assert mime.effective_date(datetime(1970, 1, 1, tzinfo=UTC), arrival) == arrival
    earlier = datetime(2026, 11, 16, tzinfo=UTC)
    assert mime.effective_date(earlier, arrival) == earlier


# -- MIME building -----------------------------------------------------------------------------


def outgoing(**overrides: object) -> OutgoingMessage:
    values: dict[str, object] = {
        "sender": Address("me@example.test", "Me"),
        "to": (Address("to@example.org", "To"),),
        "cc": (Address("cc@example.org"),),
        "bcc": (Address("hidden@example.org"),),
        "subject": "Hello",
        "body_html": "<p>Hi</p>",
        "body_text": "Hi",
    }
    values.update(overrides)
    return OutgoingMessage(**values)  # type: ignore[arg-type]


def test_built_message_cannot_be_given_extra_headers():
    message = outgoing(
        subject="Hi\r\nBcc: attacker@evil.test\r\nX-Injected: 1",
        sender=Address("me@example.test", "Me\r\nX-Evil: 1"),
        in_reply_to="<a@b>\r\nX-Evil: 2",
        references="<a@b>\n<c@d>\r\nX-Evil: 3",
        attachments=(OutgoingAttachment("a\r\nX-Evil: 4.txt", "text/plain", b"x"),),
    )
    raw = mime.wire_bytes(mime.build_message(message), include_bcc=True)
    parsed = message_from_bytes(raw)
    assert parsed["X-Injected"] is None and parsed["X-Evil"] is None
    assert "attacker" not in (parsed["Bcc"] or "")
    assert parsed["Subject"].startswith("Hi Bcc: attacker@evil.test")  # folded into one value


def test_bcc_is_kept_in_the_saved_copy_but_not_sent_over_smtp():
    built = mime.build_message(outgoing())
    assert b"hidden@example.org" not in mime.wire_bytes(built, include_bcc=False)
    assert b"hidden@example.org" in mime.wire_bytes(built, include_bcc=True)
    assert mime.recipients(outgoing()) == ["to@example.org", "cc@example.org", "hidden@example.org"]


@pytest.mark.parametrize(
    "address",
    ["a@b.c\r\nRCPT TO:<x@y.z>", "a b@c.d", "<a@b.c>", "a@b.c>", "no-at-sign", "a@b@c", ""],
)
def test_envelope_addresses_that_could_smuggle_commands_are_refused(address):
    with pytest.raises(ProviderError):
        mime.envelope_address(address)
    with pytest.raises(ProviderError):
        mime.recipients(outgoing(to=(Address(address),)))


# -- folders, ids, cursor ----------------------------------------------------------------------


def test_roles_come_from_special_use_attributes_first():
    folders = mb.parse_list(
        [
            b'(\\HasNoChildren) "/" "INBOX"',
            b'(\\HasNoChildren \\Sent) "/" "[Gmail]/Sent Mail"',
            b'(\\HasNoChildren \\Drafts) "/" "[Gmail]/Drafts"',
            b'(\\HasNoChildren \\Trash) "/" "[Gmail]/Bin"',
            b'(\\HasNoChildren \\Junk) "/" "[Gmail]/Spam"',
            b'(\\HasNoChildren \\All) "/" "[Gmail]/All Mail"',
            b'(\\HasNoChildren \\Flagged) "/" "[Gmail]/Starred"',
            b'(\\Noselect \\HasChildren) "/" "[Gmail]"',
            b'(\\HasNoChildren) "/" "Sent"',  # a user folder that merely looks like a role
            b'(\\HasNoChildren) "/" "Projects/&BB8EQAQ+BDUEOgRC-"',
        ]
    )
    by_name = {f.name: f for f in folders}
    assert by_name["INBOX"].role is FolderRole.INBOX
    assert by_name["[Gmail]/Sent Mail"].role is FolderRole.SENT
    assert by_name["[Gmail]/Bin"].role is FolderRole.TRASH
    assert by_name["[Gmail]/Spam"].role is FolderRole.SPAM
    assert by_name["Sent"].role is FolderRole.CUSTOM
    assert by_name["Projects/&BB8EQAQ+BDUEOgRC-"].title == "Projects/Проект"
    # Virtual and non-selectable folders are not synchronized.
    assert "[Gmail]/All Mail" not in by_name and "[Gmail]/Starred" not in by_name
    assert "[Gmail]" not in by_name
    assert folders[0].role is FolderRole.INBOX  # Inbox is imported first


def test_roles_fall_back_to_common_names():
    folders = mb.parse_list(
        [
            b'() "." inbox',
            b'() "." "INBOX.Sent Items"',
            b'() "." "INBOX.Drafts"',
            b'() "." "INBOX.Deleted Items"',
            b'() "." "INBOX.Junk E-mail"',
            b'() "." "INBOX.Archive"',
            b'() "." "INBOX.Archive.2024"',
            b'() "." "INBOX.Work.Archive"',
            (b'() "." {9}', b"With\\Quote"),
            b"completely unparseable",
            b'() "." "bad\r\nname"',
        ]
    )
    roles = {f.name: f.role for f in folders}
    assert roles == {
        "inbox": FolderRole.INBOX,
        "INBOX.Sent Items": FolderRole.SENT,
        "INBOX.Drafts": FolderRole.DRAFTS,
        "INBOX.Deleted Items": FolderRole.TRASH,
        "INBOX.Junk E-mail": FolderRole.SPAM,
        "INBOX.Archive": FolderRole.ARCHIVE,  # the shallowest match wins
        "INBOX.Archive.2024": FolderRole.CUSTOM,
        "INBOX.Work.Archive": FolderRole.CUSTOM,
        "With\\Quote": FolderRole.CUSTOM,
    }
    assert mb.quote("With\\Quote") == '"With\\\\Quote"'
    assert mb.quote('a"b') == '"a\\"b"'


def test_no_folder_gets_a_role_it_does_not_have():
    folders = mb.parse_list([b'() "/" "INBOX"', b'() "/" "Newsletters"'])
    assert [f.role for f in folders] == [FolderRole.INBOX, FolderRole.CUSTOM]


@pytest.mark.parametrize("name", ["", "a\r\nb", "naïve", "x\x00y"])
def test_folder_names_that_cannot_be_quoted_are_refused(name):
    with pytest.raises(ProviderNotFound):
        mb.quote(name)


def test_message_ids_round_trip_and_fit_the_column():
    key = mb.folder_key("INBOX.Projects")
    message_id = mb.encode_id(key, 1794943201, 42)
    assert mb.decode_id(message_id) == mb.MessageRef(key, 1794943201, 42)
    assert mb.folder_key("inbox") == mb.folder_key("INBOX")  # INBOX is case-insensitive
    long_name = "Archive/" + "x" * 400
    long_id = mb.encode_id(mb.folder_key(long_name), 4294967295, 4294967295)
    assert len(long_id) <= 255 and mb.decode_id(long_id).uid == 4294967295
    assert mb.folder_key(long_name) == mb.folder_key(long_name)  # deterministic hash
    assert mb.folder_key(long_name) != mb.folder_key(long_name + "y")
    worst = mb.encode_id(mb.folder_key("y" * mb.MAX_INLINE_NAME), 4294967295, 4294967295)
    assert len(worst) <= 255


@pytest.mark.parametrize(
    "value", ["", "unsaved", "18c2f0a1b2", "nSU5CT1g.1.x", "nSU5CT1g.1", "../../etc.1.2", "n.1.2"]
)
def test_foreign_ids_are_reported_as_not_found(value):
    with pytest.raises(ProviderNotFound):
        mb.decode_id(value)


def test_uid_sets_are_stored_as_ranges():
    uids = {1, 2, 3, 4, 7, 9, 10, 11, 4000000000}
    assert mb.compress(uids) == "1:4,7,9:11,4000000000"
    assert mb.expand(mb.compress(uids)) == uids
    assert mb.compress(set()) == "" and mb.expand("") == set()
    assert len(mb.compress(set(range(1, 100_001)))) < 20
    with pytest.raises(ValueError):
        mb.expand("1:9999999999")


def test_cursor_round_trip():
    cursor = mb.Cursor(
        folders={
            "nSU5CT1g": mb.FolderState(7, 120, 0, set(range(1, 121)) - {5}, {119: 1, 120: 3}),
            "nU2VudA": mb.FolderState(9, 0, 4567, set(), {}),
        },
        resume=1,
    )
    encoded = mb.encode_cursor(cursor)
    assert mb.decode_cursor(encoded) == cursor
    assert len(encoded) < 200
    assert json.loads(encoded)["v"] == 1


@pytest.mark.parametrize("value", ["", "12345", "{}", '{"v":2,"f":{}}', '{"v":1,"f":{"a":[1]}}'])
def test_unreadable_cursor_means_full_resync(value):
    with pytest.raises(ProviderCursorExpired):
        mb.decode_cursor(value)
    with pytest.raises(ProviderCursorExpired):
        mb.decode_page_token(value)


# -- guarded transport -------------------------------------------------------------------------


@pytest.fixture
def tls(tmp_path):
    return server_tls_context(tmp_path)


@pytest.fixture
def servers():
    started: list[ScriptedServer] = []
    yield started
    for server in started:
        server.close()


def connector(server: ScriptedServer, dialed: list, *addresses: str) -> MailConnector:
    return MailConnector(
        connect_timeout=5,
        io_timeout=5,
        extra_ca_file=TEST_CA,
        resolver=resolver(*(addresses or (PUBLIC_IP,))),
        dial=server.dial(dialed),
    )


async def test_imap_socket_goes_to_the_validated_ip_and_tls_uses_the_host_name(tls, servers):
    server = ScriptedServer(imap_handler(), tls=tls, implicit_tls=True)
    servers.append(server)
    dialed: list[tuple[str, int]] = []
    mail = connector(server, dialed)
    target = await mail.resolve(creds().imap, IMAP_PORTS)
    conn = await asyncio.to_thread(mail.open_imap, target, creds())
    await asyncio.to_thread(close_imap, conn)
    assert dialed == [(PUBLIC_IP, 993)]  # the resolved address, never the host name
    assert server.sni == ["mail.localhost"]
    assert any("AUTHENTICATE PLAIN" in line for line in server.received)
    assert not any(SECRET in line for line in server.received)  # sent base64 inside TLS only


async def test_the_next_validated_address_is_tried_when_one_does_not_answer(tls, servers):
    server = ScriptedServer(imap_handler(), tls=tls, implicit_tls=True)
    servers.append(server)
    dialed: list[tuple[str, int]] = []
    working = server.dial(dialed)

    def flaky(address, timeout):
        if address[0] == PUBLIC_IP:
            dialed.append(address)
            raise OSError("unreachable")
        return working(address, timeout)

    mail = MailConnector(extra_ca_file=TEST_CA, resolver=resolver(PUBLIC_IP, "1.1.1.1"), dial=flaky)
    target = await mail.resolve(creds().imap, IMAP_PORTS)
    await asyncio.to_thread(close_imap, await asyncio.to_thread(mail.open_imap, target, creds()))
    assert dialed == [(PUBLIC_IP, 993), ("1.1.1.1", 993)]


async def test_imap_certificate_for_another_host_is_rejected_before_login(tls, servers):
    server = ScriptedServer(imap_handler(), tls=tls, implicit_tls=True)
    servers.append(server)
    mail = connector(server, [])
    wrong = creds("imap.attacker.example")
    target = await mail.resolve(wrong.imap, IMAP_PORTS)
    with pytest.raises(ProviderUnavailable) as caught:
        await asyncio.to_thread(mail.open_imap, target, wrong)
    assert caught.value.service == "imap"
    assert server.received == []  # nothing was sent, least of all credentials


async def test_untrusted_certificate_authority_is_rejected(tls, servers):
    server = ScriptedServer(imap_handler(), tls=tls, implicit_tls=True)
    servers.append(server)
    dialed: list = []
    mail = MailConnector(resolver=resolver(PUBLIC_IP), dial=server.dial(dialed))  # no test CA
    target = await mail.resolve(creds().imap, IMAP_PORTS)
    with pytest.raises(ProviderUnavailable):
        await asyncio.to_thread(mail.open_imap, target, creds())
    assert server.received == []


async def test_imap_starttls_upgrades_before_authenticating(tls, servers):
    server = ScriptedServer(imap_handler(starttls=True), tls=tls)
    servers.append(server)
    dialed: list[tuple[str, int]] = []
    mail = connector(server, dialed)
    credentials = creds(imap=MailSecurity.STARTTLS)
    target = await mail.resolve(credentials.imap, IMAP_PORTS)
    conn = await asyncio.to_thread(mail.open_imap, target, credentials)
    await asyncio.to_thread(close_imap, conn)
    assert dialed == [(PUBLIC_IP, 143)] and server.sni == ["mail.localhost"]
    commands = [line.split(" ", 2)[1].upper() for line in server.received if " " in line]
    assert commands.index("STARTTLS") < commands.index("AUTHENTICATE")
    assert server.handshakes == 1


async def test_imap_without_starttls_is_refused_and_no_credentials_are_sent(servers):
    server = ScriptedServer(imap_handler(starttls=False))
    servers.append(server)
    mail = connector(server, [])
    credentials = creds(imap=MailSecurity.STARTTLS)
    target = await mail.resolve(credentials.imap, IMAP_PORTS)
    with pytest.raises(ProviderTlsRequired) as caught:
        await asyncio.to_thread(mail.open_imap, target, credentials)
    assert caught.value.service == "imap"
    sent = " ".join(server.received).upper()
    assert "LOGIN" not in sent and "AUTHENTICATE" not in sent


async def test_imap_login_is_used_when_plain_is_not_offered_and_refused_when_disabled(tls, servers):
    server = ScriptedServer(imap_handler(capabilities="IMAP4rev1"), tls=tls, implicit_tls=True)
    servers.append(server)
    mail = connector(server, [])
    target = await mail.resolve(creds().imap, IMAP_PORTS)
    await asyncio.to_thread(close_imap, await asyncio.to_thread(mail.open_imap, target, creds()))
    assert any(" LOGIN " in line for line in server.received)

    disabled = ScriptedServer(
        imap_handler(capabilities="IMAP4rev1 LOGINDISABLED"), tls=tls, implicit_tls=True
    )
    servers.append(disabled)
    mail = connector(disabled, [])
    with pytest.raises(ProviderAuthError):
        await asyncio.to_thread(mail.open_imap, target, creds())
    assert not any(
        "LOGIN " in line.upper().split("LOGINDISABLED")[-1] for line in disabled.received
    )


@pytest.mark.parametrize("security,port", [(MailSecurity.SSL, 465), (MailSecurity.STARTTLS, 587)])
async def test_smtp_socket_goes_to_the_validated_ip_and_tls_uses_the_host_name(
    tls, servers, security, port
):
    implicit = security is MailSecurity.SSL
    server = ScriptedServer(smtp_handler(starttls=not implicit), tls=tls, implicit_tls=implicit)
    servers.append(server)
    dialed: list[tuple[str, int]] = []
    mail = connector(server, dialed)
    credentials = creds(smtp=security)
    target = await mail.resolve(credentials.smtp, frozenset({465, 587}))
    conn = await asyncio.to_thread(mail.open_smtp, target, credentials)
    await asyncio.to_thread(close_smtp, conn)
    assert dialed == [(PUBLIC_IP, port)] and server.sni == ["mail.localhost"]
    commands = [line.split(" ")[0].upper() for line in server.received]
    assert "AUTH" in commands
    if not implicit:
        assert commands.index("STARTTLS") < commands.index("AUTH")
    # EHLO must not disclose this machine's host name.
    assert all(
        line.split(" ", 1)[1] == "[127.0.0.1]"
        for line in server.received
        if line.upper().startswith("EHLO")
    )


async def test_smtp_without_starttls_is_refused_and_no_credentials_are_sent(servers):
    server = ScriptedServer(smtp_handler(starttls=False))
    servers.append(server)
    mail = connector(server, [])
    credentials = creds(smtp=MailSecurity.STARTTLS)
    target = await mail.resolve(credentials.smtp, frozenset({465, 587}))
    with pytest.raises(ProviderTlsRequired) as caught:
        await asyncio.to_thread(mail.open_smtp, target, credentials)
    assert caught.value.service == "smtp"
    assert not any(line.upper().startswith("AUTH") for line in server.received)


async def test_smtp_certificate_for_another_host_is_rejected(tls, servers):
    server = ScriptedServer(smtp_handler(), tls=tls, implicit_tls=True)
    servers.append(server)
    mail = connector(server, [])
    wrong = creds("smtp.attacker.example")
    target = await mail.resolve(wrong.smtp, frozenset({465, 587}))
    with pytest.raises(ProviderUnavailable):
        await asyncio.to_thread(mail.open_smtp, target, wrong)
    assert server.received == []


@pytest.mark.parametrize(
    "addresses",
    [
        ("127.0.0.1",),
        ("10.0.0.5",),
        ("192.168.1.10",),
        ("172.16.0.1",),
        ("169.254.169.254",),  # cloud metadata
        ("100.64.0.1",),
        ("::1",),
        ("fd00:ec2::254",),
        ("::ffff:127.0.0.1",),
        (PUBLIC_IP, "127.0.0.1"),  # one bad address poisons the host
        (),
    ],
)
async def test_non_public_destinations_are_refused_before_any_connection(addresses):
    dialed: list = []

    def dial(address, timeout):
        dialed.append(address)
        raise AssertionError("must not connect")

    mail = MailConnector(resolver=resolver(*addresses), dial=dial)
    with pytest.raises(ProviderDestinationBlocked) as caught:
        await mail.verify(creds("internal.example"))
    assert caught.value.service == "imap" and dialed == []
    provider = ImapProvider(mail, creds("internal.example"))
    with pytest.raises(ProviderDestinationBlocked):
        await provider.list_folders()
    with pytest.raises(ProviderDestinationBlocked):
        await provider.send_message(outgoing())
    assert dialed == []


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "169.254.169.254", "[::1]", "10.1.2.3"])
async def test_literal_and_local_hosts_are_refused_with_the_system_resolver(host):
    with pytest.raises(ProviderDestinationBlocked):
        await MailConnector().verify(creds(host))


async def test_only_mail_ports_are_allowed_and_not_swapped_between_protocols():
    mail = MailConnector(resolver=resolver(PUBLIC_IP))
    for bad in (
        creds(imap_port=22),
        creds(imap_port=8080),
        creds(imap_port=465),
        creds(imap_port=587),
    ):
        with pytest.raises(ProviderDestinationBlocked) as caught:
            await mail.verify(bad)
        assert caught.value.service == "imap"
    for bad in (creds(smtp_port=25), creds(smtp_port=993), creds(smtp_port=6379)):
        with pytest.raises(ProviderDestinationBlocked) as caught:
            await mail.resolve(bad.smtp, frozenset({465, 587}))


async def test_smtp_destination_is_validated_before_imap_is_contacted():
    dialed: list = []

    async def resolve(host: str, port: int) -> list[str]:
        return [PUBLIC_IP] if host == "imap.example" else ["10.0.0.1"]

    mail = MailConnector(resolver=resolve, dial=lambda a, t: dialed.append(a))  # type: ignore[arg-type,return-value]
    credentials = ServerCredentials(
        MailEndpoint("imap.example", 993, MailSecurity.SSL),
        MailEndpoint("smtp.internal", 587, MailSecurity.STARTTLS),
        "u",
        "p",
    )
    with pytest.raises(ProviderDestinationBlocked) as caught:
        await mail.verify(credentials)
    assert caught.value.service == "smtp" and dialed == []


async def test_reconnect_runs_the_guard_again_and_refuses_a_rebound_host(tls, servers):
    """DNS rebinding: the host answers with a public address first and a private one later."""
    server = ScriptedServer(imap_handler(hang_up_after_login=True), tls=tls, implicit_tls=True)
    servers.append(server)
    dialed: list[tuple[str, int]] = []
    answers = iter([[PUBLIC_IP], ["127.0.0.1"], ["127.0.0.1"]])

    async def rebinding(host: str, port: int) -> list[str]:
        return next(answers)

    mail = MailConnector(
        connect_timeout=5,
        io_timeout=5,
        extra_ca_file=TEST_CA,
        resolver=rebinding,
        dial=server.dial(dialed),
    )
    provider = ImapProvider(mail, creds())
    # The first connection is dropped by the server right after login; the adapter reconnects
    # for this read, resolves again, and the guard refuses the new (loopback) answer.
    with pytest.raises(ProviderDestinationBlocked):
        await provider.list_folders()
    assert dialed == [(PUBLIC_IP, 993)]
    assert server.connections == 1
    await provider.aclose()


async def test_test_only_switch_allows_loopback_but_still_requires_verified_tls(tls, servers):
    server = ScriptedServer(imap_handler(), tls=tls, implicit_tls=True)
    servers.append(server)
    relaxed = MailConnector(allow_private_networks=True)  # no extra CA: verification stays on
    credentials = creds("localhost", imap_port=server.port)
    target = await relaxed.resolve(credentials.imap, IMAP_PORTS)
    assert set(target.addresses) <= {"127.0.0.1", "::1"}
    with pytest.raises(ProviderUnavailable):
        await asyncio.to_thread(relaxed.open_imap, target, credentials)
    assert server.received == []


# -- synchronization against a scripted mailbox ------------------------------------------------


class FakeFolder:
    def __init__(self, uidvalidity: int) -> None:
        self.uidvalidity = uidvalidity
        self.uidnext = 1
        self.messages: dict[int, set[str]] = {}
        self.modseqs: dict[int, int] = {}


class FakeImap:
    """Just enough of ``imaplib.IMAP4`` for the adapter's read path."""

    def __init__(self, *, condstore: bool = False) -> None:
        self.capabilities = ("IMAP4REV1", "UIDPLUS", "MOVE") + (("CONDSTORE",) if condstore else ())
        self.condstore = condstore
        self.folders: dict[str, FakeFolder] = {"INBOX": FakeFolder(100)}
        self.selected: FakeFolder | None = None
        self.modseq = 10
        self.commands: list[str] = []
        self._responses: dict[str, list] = {}

    def add(self, folder: str, flags: set[str] | None = None) -> int:
        box = self.folders[folder]
        uid, box.uidnext = box.uidnext, box.uidnext + 1
        box.messages[uid] = set(flags or ())
        self.touch(folder, uid)
        return uid

    def touch(self, folder: str, uid: int) -> None:
        self.modseq += 1
        self.folders[folder].modseqs[uid] = self.modseq

    def list(self, *_):
        return "OK", [f'() "/" "{name}"'.encode() for name in self.folders]

    def status(self, mailbox: str, items: str):
        self.commands.append(f"STATUS {mailbox}")
        box = self.folders.get(mailbox.strip('"'))
        if box is None:
            return "NO", [b"no such mailbox"]
        text = f"{mailbox} (MESSAGES {len(box.messages)} UIDNEXT {box.uidnext} UIDVALIDITY {box.uidvalidity}"
        if "HIGHESTMODSEQ" in items:
            text += f" HIGHESTMODSEQ {self.modseq}"
        return "OK", [(text + ")").encode()]

    def select(self, mailbox: str, readonly: bool = False):
        self.commands.append(f"SELECT {mailbox}")
        self.selected = self.folders[mailbox.strip('"')]
        self._responses["UIDVALIDITY"] = [str(self.selected.uidvalidity).encode()]
        return "OK", [b"1"]

    def response(self, code: str):
        return code, self._responses.pop(code, [None])

    def uid(self, command: str, *args: str):
        self.commands.append(f"UID {command} {' '.join(args)}")
        box = self.selected
        assert box is not None
        if command == "SEARCH":
            if args[0] == "ALL":
                uids = sorted(box.messages)
            else:
                low, _, high = args[1].partition(":")
                top = max(box.messages, default=0) if high == "*" else int(high or low)
                uids = [u for u in sorted(box.messages) if int(low) <= u <= top]
                if high == "*" and not uids and box.messages:
                    uids = [max(box.messages)]  # RFC 3501: n:* always matches the last message
            return "OK", [" ".join(map(str, uids)).encode()]
        if command == "FETCH":
            low, _, high = args[0].partition(":")
            since = int(args[2].split()[1].rstrip(")")) if len(args) > 2 else None
            rows = []
            for uid in sorted(box.messages):
                if not int(low) <= uid <= int(high or low):
                    continue
                if since is not None and box.modseqs[uid] <= since:
                    continue
                flags = " ".join(sorted(box.messages[uid]))
                extra = f" MODSEQ ({box.modseqs[uid]})" if since is not None else ""
                rows.append(f"{uid} (UID {uid} FLAGS ({flags}){extra})".encode())
            return "OK", rows or [None]
        raise AssertionError(command)

    def logout(self):
        return "BYE", []


def provider_on(fake: FakeImap, **kwargs) -> ImapProvider:
    provider = ImapProvider(MailConnector(), creds(), **kwargs)
    provider._conn = fake  # type: ignore[assignment]
    provider._capabilities = frozenset(fake.capabilities)
    return provider


def ids(fake: FakeImap, folder: str, *uids: int) -> tuple[str, ...]:
    box = fake.folders[folder]
    return tuple(mb.encode_id(mb.folder_key(folder), box.uidvalidity, uid) for uid in uids)


async def start(provider: ImapProvider) -> str:
    page = await provider.list_messages(page_token=None, page_size=1000)
    assert page.cursor is not None
    return page.cursor


async def test_initial_listing_pages_newest_first_and_returns_a_cursor():
    fake = FakeImap()
    fake.folders["Sent"] = FakeFolder(200)
    for _ in range(5):
        fake.add("INBOX")
    fake.add("Sent")
    provider = provider_on(fake)
    first = await provider.list_messages(page_token=None, page_size=2)
    assert first.message_ids == ids(fake, "INBOX", 5, 4) and first.cursor
    second = await provider.list_messages(page_token=first.next_page_token, page_size=2)
    assert second.message_ids == ids(fake, "INBOX", 3, 2) and second.cursor is None
    third = await provider.list_messages(page_token=second.next_page_token, page_size=2)
    assert third.message_ids == (*ids(fake, "INBOX", 1), *ids(fake, "Sent", 1))
    assert third.next_page_token is None
    assert (await provider.synchronize(first.cursor)).upserted_message_ids == ()


async def test_sync_reports_new_messages_flag_changes_and_expunges_without_condstore():
    fake = FakeImap()
    for _ in range(3):
        fake.add("INBOX")
    provider = provider_on(fake)
    cursor = await start(provider)
    assert not any("CHANGEDSINCE" in c for c in fake.commands)

    new = fake.add("INBOX")
    fake.folders["INBOX"].messages[2].add("\\Seen")
    del fake.folders["INBOX"].messages[1]
    changes = await provider.synchronize(cursor)
    assert set(changes.upserted_message_ids) == set(ids(fake, "INBOX", new, 2))
    assert changes.deleted_message_ids == ids(fake, "INBOX", 1)

    again = await provider.synchronize(changes.cursor)
    assert again.upserted_message_ids == () and again.deleted_message_ids == ()
    # Expunging an old message while a new one arrives keeps the count equal — still noticed.
    del fake.folders["INBOX"].messages[2]
    newer = fake.add("INBOX")
    third = await provider.synchronize(again.cursor)
    assert third.upserted_message_ids == ids(fake, "INBOX", newer)
    assert third.deleted_message_ids == ids(fake, "INBOX", 2)


async def test_flag_changes_outside_the_recent_window_need_condstore():
    fake = FakeImap()
    for _ in range(mb.FLAG_WINDOW + 20):
        fake.add("INBOX")
    provider = provider_on(fake)
    cursor = await start(provider)
    fake.folders["INBOX"].messages[1].add("\\Seen")  # older than the window
    fake.folders["INBOX"].messages[mb.FLAG_WINDOW + 20].add("\\Flagged")
    changes = await provider.synchronize(cursor)
    assert changes.upserted_message_ids == ids(fake, "INBOX", mb.FLAG_WINDOW + 20)


async def test_sync_uses_condstore_when_offered():
    fake = FakeImap(condstore=True)
    for _ in range(300):
        fake.add("INBOX")
    provider = provider_on(fake)
    cursor = await start(provider)
    assert mb.decode_cursor(cursor).folders[mb.folder_key("INBOX")].modseq == fake.modseq

    quiet = await provider.synchronize(cursor)
    assert quiet.upserted_message_ids == ()
    fake.commands.clear()
    assert (await provider.synchronize(quiet.cursor)).upserted_message_ids == ()
    assert not any(c.startswith("UID FETCH") for c in fake.commands)  # nothing changed: STATUS only

    fake.folders["INBOX"].messages[1].add("\\Seen")  # far outside any "recent window"
    fake.touch("INBOX", 1)
    changes = await provider.synchronize(quiet.cursor)
    assert changes.upserted_message_ids == ids(fake, "INBOX", 1)
    assert any("CHANGEDSINCE" in c for c in fake.commands)
    assert (await provider.synchronize(changes.cursor)).upserted_message_ids == ()


async def test_work_per_call_is_bounded_and_resumes_from_the_cursor():
    fake = FakeImap(condstore=True)
    fake.folders["Sent"] = FakeFolder(200)
    for _ in range(4):
        fake.add("INBOX")
    provider = provider_on(fake, max_changes=3)
    cursor = await start(provider)
    for _ in range(5):
        fake.add("INBOX")
    fake.add("Sent")
    for uid in (1, 2, 3, 4):
        fake.folders["INBOX"].messages[uid].add("\\Seen")
        fake.touch("INBOX", uid)

    seen: list[str] = []
    for _ in range(10):
        changes = await provider.synchronize(cursor)
        assert len(changes.upserted_message_ids) <= 3
        seen.extend(changes.upserted_message_ids)
        cursor = changes.cursor
        if not changes.upserted_message_ids:
            break
    assert set(seen) == {*ids(fake, "INBOX", *range(1, 10)), *ids(fake, "Sent", 1)}
    # A message that arrived during a backlog may be reported once more as "changed" (its
    # mod-sequence is newer than the last completed flag check); never more than that.
    assert all(seen.count(message_id) <= 2 for message_id in seen)


async def test_uidvalidity_change_expires_the_cursor():
    fake = FakeImap()
    fake.add("INBOX")
    provider = provider_on(fake)
    cursor = await start(provider)
    fake.folders["INBOX"].uidvalidity += 1
    with pytest.raises(ProviderCursorExpired):
        await provider.synchronize(cursor)


async def test_removed_folder_expires_the_cursor_and_new_folder_is_picked_up():
    fake = FakeImap()
    fake.folders["Old"] = FakeFolder(300)
    fake.add("Old")
    provider = provider_on(fake)
    cursor = await start(provider)
    fake.folders["New"] = FakeFolder(400)
    uid = fake.add("New")
    changes = await provider.synchronize(cursor)
    assert changes.upserted_message_ids == ids(fake, "New", uid)
    del fake.folders["Old"]
    with pytest.raises(ProviderCursorExpired):
        await provider.synchronize(changes.cursor)


async def test_message_id_from_an_earlier_uidvalidity_is_not_found():
    fake = FakeImap()
    fake.add("INBOX")
    provider = provider_on(fake)
    stale = mb.encode_id(mb.folder_key("INBOX"), 99, 1)
    with pytest.raises(ProviderNotFound):
        await provider.get_message(stale)
    with pytest.raises(ProviderNotFound):
        await provider.modify_message(stale, ThreadAction.MARK_READ)
    with pytest.raises(ProviderNotFound):
        await provider.get_message("18c2f0a1b2c3")  # an id from another provider


async def test_actions_without_a_matching_folder_or_server_support_are_unsupported():
    fake = FakeImap()
    uid = fake.add("INBOX")
    provider = provider_on(fake)
    message_id = ids(fake, "INBOX", uid)[0]
    for action in (ThreadAction.ARCHIVE, ThreadAction.SPAM, ThreadAction.TRASH):
        with pytest.raises(ProviderUnsupported):
            await provider.modify_thread(message_id, action)
    with pytest.raises(ProviderUnsupported):
        await provider.create_draft(outgoing())
    with pytest.raises(ProviderUnsupported):
        await provider.search_messages("x", page_token=None, page_size=10)
    with pytest.raises(ProviderUnsupported):
        await provider.send_draft(message_id)
    assert provider.capabilities.server_search is False and provider.capabilities.threads is False

    fake.folders["Trash"] = FakeFolder(500)
    fake.capabilities = ("IMAP4REV1",)  # neither MOVE nor UIDPLUS
    bare = provider_on(fake)
    with pytest.raises(ProviderUnsupported):
        await bare.modify_thread(message_id, ThreadAction.TRASH)
    assert not any(c.startswith(("UID COPY", "UID MOVE", "UID STORE")) for c in fake.commands)


# -- registry ----------------------------------------------------------------------------------


async def test_registry_builds_the_imap_adapter_only_for_server_credentials():
    import httpx

    from app.integrations.email_providers.contracts import Credentials, ProviderKind
    from app.integrations.email_providers.registry import DefaultProviderRegistry
    from tests.conftest import make_settings

    async with httpx.AsyncClient() as http:
        registry = DefaultProviderRegistry(make_settings(), http)
        assert registry.is_available(ProviderKind.IMAP) is True
        assert registry.capabilities(ProviderKind.IMAP).oauth is False
        assert isinstance(registry.provider(ProviderKind.IMAP, creds()), ImapProvider)
        # The production wiring keeps the guard strict and trusts no extra authority.
        assert registry._mail.allow_private_networks is False
        assert registry._mail.extra_ca_file is None
        with pytest.raises(ProviderUnsupported):
            registry.provider(ProviderKind.GMAIL, creds())
        with pytest.raises(ProviderUnsupported):
            registry.provider(ProviderKind.IMAP, Credentials(access_token="t"))
        with pytest.raises(ProviderUnsupported):
            registry.oauth_client(ProviderKind.IMAP)
        with pytest.raises(ProviderUnsupported):
            await registry.verify_credentials(ProviderKind.GMAIL, creds())
        with pytest.raises(ProviderDestinationBlocked):
            await registry.verify_credentials(ProviderKind.IMAP, creds("127.0.0.1"))
