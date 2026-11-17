"""Helpers for the IMAP adapter tests.

* ``GreenMail`` — the real IMAP/SMTP server from ``docker-compose.dev.yml`` (loopback only).
* ``ScriptedServer`` — a tiny in-process TCP/TLS server used to observe exactly what the
  transport sends, to which address, and with which SNI.
* ``ImapTestRegistry`` — the fake registry of the other tests, with the real IMAP adapter.
"""

from __future__ import annotations

import imaplib
import os
import socket
import ssl
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization import pkcs12

from app.integrations.email_providers.contracts import (
    Credentials,
    MailEndpoint,
    MailSecurity,
    ProviderCapabilities,
    ProviderKind,
    ServerCredentials,
)
from app.integrations.email_providers.imap import IMAP_CAPABILITIES, ImapProvider, MailConnector
from tests.fakes import FakeRegistry

FIXTURES = Path(__file__).resolve().parents[2] / "infra" / "greenmail"
TEST_CA = str(FIXTURES / "test-ca.pem")
HOST = os.environ.get("TEST_MAIL_HOST", "localhost")
IMAPS_PORT = int(os.environ.get("TEST_IMAPS_PORT", "13993"))
IMAP_PORT = int(os.environ.get("TEST_IMAP_PORT", "13143"))
SMTPS_PORT = int(os.environ.get("TEST_SMTPS_PORT", "13465"))
API = os.environ.get("TEST_GREENMAIL_API", "http://127.0.0.1:18081")
STANDARD_FOLDERS = ("Sent", "Drafts", "Trash", "Archive", "Junk")


def local_connector(**overrides: object) -> MailConnector:
    values: dict[str, object] = {"allow_private_networks": True, "extra_ca_file": TEST_CA}
    values.update(overrides)
    return MailConnector(**values)  # type: ignore[arg-type]


class ImapTestRegistry(FakeRegistry):
    """Gmail stays fake; IMAP is the real adapter pointed at the local test server."""

    def __init__(self, connector: MailConnector | None = None) -> None:
        super().__init__()
        self.connector = connector or local_connector()
        self.available_kinds = {ProviderKind.GMAIL, ProviderKind.IMAP}

    def capabilities(self, kind: ProviderKind) -> ProviderCapabilities:
        return IMAP_CAPABILITIES if kind is ProviderKind.IMAP else super().capabilities(kind)

    def provider(self, kind, credentials):  # type: ignore[no-untyped-def,override]
        if isinstance(credentials, ServerCredentials):
            return ImapProvider(self.connector, credentials)
        assert isinstance(credentials, Credentials)
        return super().provider(kind, credentials)

    async def verify_credentials(self, kind: ProviderKind, credentials: ServerCredentials) -> None:
        await self.connector.verify(credentials)


@dataclass
class Mailbox:
    """One throwaway user on the GreenMail server."""

    email: str
    password: str

    def credentials(self, password: str | None = None) -> ServerCredentials:
        return ServerCredentials(
            MailEndpoint(HOST, IMAPS_PORT, MailSecurity.SSL),
            MailEndpoint(HOST, SMTPS_PORT, MailSecurity.SSL),
            self.email,
            password or self.password,
        )

    def payload(self, **overrides: object) -> dict[str, object]:
        body: dict[str, object] = {
            "email_address": self.email,
            "imap": {"host": HOST, "port": IMAPS_PORT, "security": "ssl"},
            "smtp": {"host": HOST, "port": SMTPS_PORT, "security": "ssl"},
            "username": self.email,
            "password": self.password,
        }
        body.update(overrides)
        return body

    def client(self) -> imaplib.IMAP4_SSL:
        context = ssl.create_default_context()
        context.load_verify_locations(TEST_CA)
        client = imaplib.IMAP4_SSL(HOST, IMAPS_PORT, ssl_context=context, timeout=10)
        client.login(self.email, self.password)
        return client

    def create_folders(self, names: tuple[str, ...] = STANDARD_FOLDERS) -> None:
        client = self.client()
        for name in names:
            client.create(name)
        client.logout()

    def deliver(self, raw: bytes, folder: str = "INBOX", flags: str | None = None) -> None:
        client = self.client()
        typ, _ = client.append(folder, flags, None, raw)  # type: ignore[arg-type]
        assert typ == "OK"
        client.logout()

    def uids(self, folder: str) -> list[int]:
        client = self.client()
        client.select(folder, readonly=True)
        _, data = client.uid("SEARCH", "ALL")
        client.logout()
        return [int(n) for n in data[0].split()]

    def flags(self, folder: str, uid: int) -> str:
        client = self.client()
        client.select(folder, readonly=True)
        _, data = client.uid("FETCH", str(uid), "(FLAGS)")
        client.logout()
        return data[0].decode() if data and data[0] else ""

    def raw(self, folder: str, uid: int) -> bytes:
        client = self.client()
        client.select(folder, readonly=True)
        _, data = client.uid("FETCH", str(uid), "(BODY.PEEK[])")
        client.logout()
        return data[0][1]


class GreenMail:
    """Client for the test server's REST API. One connection per call: after an internal
    error GreenMail leaves a kept-alive connection unusable."""

    def __init__(self) -> None:
        self._users: list[str] = []

    @staticmethod
    def _call(method: str, path: str, **kwargs: object) -> httpx.Response:
        return httpx.request(  # type: ignore[arg-type]
            method, API + path, timeout=10, headers={"Connection": "close"}, **kwargs
        )

    def ensure_running(self) -> None:
        try:
            self._call("GET", "/api/service/readiness").raise_for_status()
        except httpx.HTTPError as exc:  # pragma: no cover - environment problem
            raise RuntimeError(
                "The IMAP test server is not reachable. Start it with "
                "`docker compose -f docker-compose.dev.yml up -d greenmail`."
            ) from exc

    def user(self, password: str | None = None, *, folders: bool = True) -> Mailbox:
        email = f"u{uuid.uuid4().hex[:12]}@imap.example.org"
        mailbox = Mailbox(email, password or f"pw-{uuid.uuid4().hex}")
        self._call(
            "POST",
            "/api/user",
            json={"email": mailbox.email, "login": mailbox.email, "password": mailbox.password},
        ).raise_for_status()
        self._users.append(mailbox.email)
        if folders:
            mailbox.create_folders()
        return mailbox

    def close(self) -> None:
        # Best effort: GreenMail 2.1.3 answers 500 when deleting a user whose folders were
        # ever selected by a session that has since logged out (the user is removed anyway).
        for email in self._users:
            try:
                self._call("DELETE", f"/api/user/{email}")
            except httpx.HTTPError:
                pass


def mail(
    subject: str,
    *,
    sender: str = "Bob Example <bob@example.org>",
    to: str = "me@example.test",
    body: str = "<p>Hello</p>",
    message_id: str | None = None,
    date: str = "Tue, 17 Nov 2026 10:00:00 +0000",
) -> bytes:
    message_id = message_id or f"<{uuid.uuid4().hex}@example.org>"
    return (
        f"From: {sender}\r\nTo: {to}\r\nSubject: {subject}\r\nMessage-ID: {message_id}\r\n"
        f"Date: {date}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n"
        f"{body}\r\n"
    ).encode()


# -- in-process scripted server ----------------------------------------------------------------


def server_tls_context(tmp_path: Path) -> ssl.SSLContext:
    """Server-side context using the committed test-only key (SAN: localhost, mail.localhost)."""
    key, cert, _ = pkcs12.load_key_and_certificates(
        (FIXTURES / "greenmail.p12").read_bytes(), b"changeit"
    )
    assert key is not None and cert is not None
    key_file, cert_file = tmp_path / "key.pem", tmp_path / "cert.pem"
    key_file.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(cert_file), str(key_file))
    return context


Handler = Callable[["Connection"], None]


@dataclass
class Connection:
    sock: socket.socket
    server: ScriptedServer

    def send(self, line: str) -> None:
        self.sock.sendall(line.encode() + b"\r\n")

    def readline(self) -> str:
        data = b""
        while not data.endswith(b"\n"):
            chunk = self.sock.recv(1)
            if not chunk:
                break
            data += chunk
        line = data.decode("utf-8", "replace").rstrip("\r\n")
        if line:
            self.server.received.append(line)
        return line

    def upgrade(self) -> None:
        assert self.server.tls is not None
        self.sock = self.server.tls.wrap_socket(self.sock, server_side=True)
        self.server.handshakes += 1


@dataclass
class ScriptedServer:
    """Accepts connections on loopback and runs ``handler`` for each, recording every line
    received and the SNI name of every TLS handshake."""

    handler: Handler
    tls: ssl.SSLContext | None = None
    implicit_tls: bool = False
    received: list[str] = field(default_factory=list)
    sni: list[str | None] = field(default_factory=list)
    handshakes: int = 0
    connections: int = 0

    def __post_init__(self) -> None:
        if self.tls is not None:
            self.tls.sni_callback = lambda _sock, name, _ctx: self.sni.append(name)
        self._listener = socket.create_server(("127.0.0.1", 0))
        self._listener.settimeout(0.2)
        self.port = self._listener.getsockname()[1]
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self) -> None:
        while not self._stop.is_set():
            try:
                sock, _ = self._listener.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            self.connections += 1
            sock.settimeout(5)
            connection = Connection(sock, self)
            try:
                if self.implicit_tls:
                    connection.upgrade()
                self.handler(connection)
            except (OSError, ssl.SSLError):
                pass
            finally:
                try:
                    connection.sock.close()
                except OSError:
                    pass

    def dial(
        self, record: list[tuple[str, int]]
    ) -> Callable[[tuple[str, int], float], socket.socket]:
        """A socket factory that notes where the transport wanted to go and connects here."""

        def factory(address: tuple[str, int], timeout: float) -> socket.socket:
            record.append(address)
            return socket.create_connection(("127.0.0.1", self.port), timeout)

        return factory

    def close(self) -> None:
        self._stop.set()
        self._listener.close()
        self._thread.join(timeout=2)


def imap_handler(
    *,
    capabilities: str = "IMAP4rev1 AUTH=PLAIN",
    starttls: bool = False,
    hang_up_after_login: bool = False,
) -> Handler:
    """Minimal IMAP: greeting, CAPABILITY, STARTTLS, LOGIN/AUTHENTICATE PLAIN, LIST, LOGOUT."""

    def handle(conn: Connection) -> None:
        caps = capabilities + (" STARTTLS" if starttls else "")
        conn.send(f"* OK [CAPABILITY {caps}] ready")
        while True:
            line = conn.readline()
            if not line:
                return
            tag, _, rest = line.partition(" ")
            command = rest.split(" ")[0].upper()
            if command == "CAPABILITY":
                conn.send(f"* CAPABILITY {caps}")
                conn.send(f"{tag} OK done")
            elif command == "STARTTLS" and starttls:
                conn.send(f"{tag} OK begin TLS")
                conn.upgrade()
                caps = capabilities
            elif command == "AUTHENTICATE":
                conn.send("+ ")
                conn.readline()
                conn.send(f"{tag} OK authenticated")
                if hang_up_after_login:
                    return
            elif command == "LOGIN":
                conn.send(f"{tag} OK logged in")
            elif command == "LOGOUT":
                conn.send("* BYE")
                conn.send(f"{tag} OK bye")
                return
            else:
                conn.send(f"{tag} BAD unsupported")

    return handle


def smtp_handler(*, starttls: bool = False, auth: bool = True) -> Handler:
    def handle(conn: Connection) -> None:
        conn.send("220 test ESMTP")
        secured = not starttls
        while True:
            line = conn.readline()
            if not line:
                return
            command = line.split(" ")[0].upper()
            if command in ("EHLO", "HELO"):
                extensions = ["test"]
                if starttls and not secured:
                    extensions.append("STARTTLS")
                if auth:
                    extensions.append("AUTH PLAIN LOGIN")
                for ext in extensions[:-1]:
                    conn.send(f"250-{ext}")
                conn.send(f"250 {extensions[-1]}")
            elif command == "STARTTLS" and starttls:
                conn.send("220 go ahead")
                conn.upgrade()
                secured = True
            elif command == "AUTH":
                conn.send("235 ok")
            elif command == "QUIT":
                conn.send("221 bye")
                return
            else:
                conn.send("502 unsupported")

    return handle
