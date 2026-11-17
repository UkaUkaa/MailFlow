from __future__ import annotations

import base64
import os
import uuid

import pytest

from app.core.security.filenames import (
    content_disposition_attachment,
    normalize_mime_type,
    sanitize_filename,
)
from app.core.security.html import html_to_text, sanitize_email_html
from app.core.security.passwords import Argon2PasswordHasher
from app.core.security.ssrf import BlockedDestinationError, is_public_ip, resolve_public_endpoint
from app.core.security.tokens import generate_token, hash_token
from app.modules.authentication.domain.entities import validate_password
from app.modules.token_vault.domain import SealedSecret, VaultError
from app.modules.token_vault.infrastructure import AesGcmKeyring
from app.shared.application.pagination import KeysetCursor, clamp_limit
from app.shared.domain.errors import InvalidInputError

# -- HTML sanitizer --------------------------------------------------------------------------

XSS_PAYLOADS = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<svg onload=alert(1)><circle/></svg>",
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    "<iframe src='https://evil.test'></iframe>",
    "<object data='x'></object><embed src='x'>",
    "<form action='https://evil.test'><input name=p><button>go</button></form>",
    "<body onload=alert(1)>",
    '<div style="background:url(javascript:alert(1))">x</div>',
    '<div style="width: expression(alert(1))">x</div>',
    "<style>@import url(https://evil.test/x.css);</style>",
    "<meta http-equiv='refresh' content='0;url=https://evil.test'>",
    "<link rel=stylesheet href='https://evil.test/x.css'>",
    "<base href='https://evil.test/'>",
    "<math><mi xlink:href='javascript:alert(1)'>x</mi></math>",
    "<img src='data:image/svg+xml;base64,PHN2Zz4='>",
    "<video><source onerror=alert(1)></video>",
    "<details open ontoggle=alert(1)>x</details>",
    "<p>ok</p><!-- <script>alert(1)</script> -->",
]


@pytest.mark.parametrize("payload", XSS_PAYLOADS)
def test_sanitizer_neutralizes_active_content(payload):
    out = sanitize_email_html(payload).html.lower()
    for needle in ("<script", "javascript:", "vbscript:", "onerror", "onload", "ontoggle",
                   "<iframe", "<object", "<embed", "<form", "<input", "<style", "<meta", "<link",
                   "<base", "<svg", "<math", "expression(", "@import", "data:text",
                   "data:image/svg", "<!--"):  # fmt: skip
        assert needle not in out, (payload, out)


def test_sanitizer_keeps_safe_formatting_and_hardens_links():
    result = sanitize_email_html(
        '<p style="color:red;position:fixed">Hi <b>there</b></p>'
        '<a href="https://example.com/a?b=1">link</a>'
        '<table><tr><td align="left">cell</td></tr></table>'
    )
    assert "<b>there</b>" in result.html and "<table>" in result.html
    assert "color:red" in result.html and "position" not in result.html
    assert 'rel="noopener noreferrer nofollow"' in result.html and 'target="_blank"' in result.html
    assert result.has_remote_images is False


def test_sanitizer_flags_remote_images_and_keeps_inline_ones():
    remote = sanitize_email_html('<img src="https://t.test/pixel.gif" width="1">')
    assert remote.has_remote_images is True
    inline = sanitize_email_html(
        '<img src="cid:abc"><img src="data:image/png;base64,iVBORw0KGgo=">'
    )
    assert inline.has_remote_images is False and "cid:abc" in inline.html
    assert "data:image/png" in inline.html


def test_sanitizer_survives_garbage():
    assert sanitize_email_html("<<<>>><p") is not None
    assert sanitize_email_html("\x00<p>a</p>" * 10).html
    assert html_to_text("<p>one</p><div>two<br>three</div>") == "one\ntwo\nthree"


# -- filenames -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("../../etc/passwd", "passwd"),
        ("..\\..\\windows\\system32\\cmd.exe", "cmd.exe"),
        ("", "attachment"),
        (None, "attachment"),
        ("..", "attachment"),
        ("CON", "attachment"),
        ("nul.txt", "attachment"),
        ("a\x00b\r\nc.txt", "a_b_c.txt"),
        ('quo"te<>.pdf', "quo_te_.pdf"),
        ("звіт.pdf", "звіт.pdf"),
    ],
)
def test_sanitize_filename(raw, expected):
    assert sanitize_filename(raw) == expected


def test_long_filename_keeps_extension():
    name = sanitize_filename("a" * 400 + ".pdf")
    assert len(name) <= 180 and name.endswith(".pdf")


def test_content_disposition_cannot_be_injected():
    header = content_disposition_attachment('x"\r\nSet-Cookie: a=b.txt')
    assert "\r" not in header and "\n" not in header
    assert header.startswith("attachment; ")
    assert header.count('"') == 2


def test_normalize_mime_type():
    assert normalize_mime_type("Text/HTML; charset=utf-8") == "text/html"
    assert normalize_mime_type("garbage") == "application/octet-stream"
    assert normalize_mime_type("a/b\r\nX: y") == "application/octet-stream"
    assert normalize_mime_type(None) == "application/octet-stream"


# -- SSRF guard ------------------------------------------------------------------------------

BLOCKED_IPS = [
    "127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0",
    "100.64.0.1", "224.0.0.1", "255.255.255.255", "::1", "fe80::1", "fc00::1", "fd00:ec2::254",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::", "64:ff9b::7f00:1", "2002:7f00:1::",
    "198.18.0.1", "192.0.0.1",
]  # fmt: skip


@pytest.mark.parametrize("ip", BLOCKED_IPS)
def test_non_public_addresses_are_blocked(ip):
    assert is_public_ip(ip) is False


@pytest.mark.parametrize("ip", ["8.8.8.8", "142.250.74.14", "2607:f8b0:4004:800::200e"])
def test_public_addresses_are_allowed(ip):
    assert is_public_ip(ip) is True


def _resolver(*addresses):
    async def resolve(host, port):
        return list(addresses)

    return resolve


async def test_resolve_requires_all_addresses_public():
    ok = await resolve_public_endpoint("imap.example.com", 993, resolver=_resolver("8.8.8.8"))
    assert ok.addresses == ("8.8.8.8",)
    # One private address among public ones (DNS rebinding style) blocks the whole host.
    with pytest.raises(BlockedDestinationError):
        await resolve_public_endpoint(
            "imap.example.com", 993, resolver=_resolver("8.8.8.8", "10.0.0.1")
        )
    with pytest.raises(BlockedDestinationError):
        await resolve_public_endpoint("imap.example.com", 993, resolver=_resolver())


@pytest.mark.parametrize(
    ("host", "port"),
    [
        ("127.0.0.1", 993), ("[::1]", 993), ("169.254.169.254", 993), ("localhost", 993),
        ("imap.example.com", 22), ("imap.example.com", 6379), ("imap.example.com", 5432),
        ("exa mple.com", 993), ("user@host", 993), ("", 993), ("a" * 300, 993),
    ],
)  # fmt: skip
async def test_resolve_rejects_dangerous_targets(host, port):
    with pytest.raises(BlockedDestinationError):
        await resolve_public_endpoint(host, port, resolver=_resolver("127.0.0.1"))


async def test_resolve_handles_dns_failure_and_timeout():
    async def failing(host, port):
        raise OSError("nxdomain")

    with pytest.raises(BlockedDestinationError):
        await resolve_public_endpoint("nope.example.com", 993, resolver=failing)

    async def slow(host, port):
        import asyncio

        await asyncio.sleep(1)
        return ["8.8.8.8"]

    with pytest.raises(BlockedDestinationError):
        await resolve_public_endpoint("slow.example.com", 993, resolver=slow, timeout_seconds=0.01)


# -- passwords, tokens -----------------------------------------------------------------------


def test_argon2id_hash_and_verify():
    hasher = Argon2PasswordHasher()
    hashed = hasher.hash("correct horse battery")
    assert hashed.startswith("$argon2id$")
    assert hasher.verify(hashed, "correct horse battery") is True
    assert hasher.verify(hashed, "wrong") is False
    assert hasher.verify(None, "anything") is False  # unknown user path never succeeds
    assert hasher.verify("not-a-hash", "x") is False
    assert hasher.hash("same") != hasher.hash("same")


@pytest.mark.parametrize("password", ["short", "x" * 129, " leading space long", "          "])
def test_password_policy_rejects(password):
    with pytest.raises(InvalidInputError):
        validate_password(password)


def test_tokens_are_random_and_hashes_stable():
    assert generate_token() != generate_token() and len(generate_token()) >= 43
    assert hash_token("abc") == hash_token("abc") and len(hash_token("abc")) == 64


# -- vault cipher ----------------------------------------------------------------------------


def _key() -> bytes:
    return os.urandom(32)


def test_vault_roundtrip_and_tamper_detection():
    ring = AesGcmKeyring({"k1": _key()}, "k1")
    sealed = ring.seal(b"refresh-token", aad=b"user|acct")
    assert b"refresh-token" not in sealed.ciphertext
    assert ring.open(sealed, aad=b"user|acct") == b"refresh-token"
    assert ring.seal(b"refresh-token", aad=b"a").nonce != sealed.nonce  # fresh nonce every time
    with pytest.raises(VaultError):
        ring.open(sealed, aad=b"other-user|acct")
    flipped = bytes([sealed.ciphertext[0] ^ 1]) + sealed.ciphertext[1:]
    with pytest.raises(VaultError):
        ring.open(SealedSecret(sealed.key_id, sealed.nonce, flipped), aad=b"user|acct")
    with pytest.raises(VaultError):
        ring.open(SealedSecret("unknown", sealed.nonce, sealed.ciphertext), aad=b"user|acct")


def test_vault_key_rotation_reads_old_writes_new():
    old, new = _key(), _key()
    before = AesGcmKeyring({"k1": old}, "k1")
    sealed = before.seal(b"secret", aad=b"x")
    after = AesGcmKeyring({"k1": old, "k2": new}, "k2")
    assert after.open(sealed, aad=b"x") == b"secret"
    assert after.seal(b"secret", aad=b"x").key_id == "k2"
    with pytest.raises(VaultError):
        AesGcmKeyring({"k2": new}, "k2").open(sealed, aad=b"x")


def test_vault_configuration_errors():
    good = base64.b64encode(_key()).decode()
    assert AesGcmKeyring.from_config(f"a:{good}", "").primary_key_id == "a"
    for raw, primary in (("", "a"), ("a:not-base64!!", "a"), (f"a:{good}", "missing"),
                         ("a:" + base64.b64encode(b"short").decode(), "a")):  # fmt: skip
        with pytest.raises(VaultError):
            AesGcmKeyring.from_config(raw, primary)


# -- pagination ------------------------------------------------------------------------------


def test_cursor_roundtrip_and_rejects_garbage():
    from datetime import UTC, datetime

    cursor = KeysetCursor(at=datetime(2026, 1, 2, tzinfo=UTC), id=str(uuid.uuid4()))
    assert KeysetCursor.decode(cursor.encode()) == cursor
    assert KeysetCursor.decode(None) is None
    for bad in ("%%%", "e30", "bm90IGpzb24"):
        with pytest.raises(InvalidInputError):
            KeysetCursor.decode(bad)
    assert clamp_limit(None) == 30 and clamp_limit(0) == 1 and clamp_limit(10_000) == 100
