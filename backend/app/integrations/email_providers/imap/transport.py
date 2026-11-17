"""Guarded connections to user-supplied IMAP and SMTP servers.

Every connect — the first one and every reconnect — goes through the same three steps:

1. :func:`app.core.security.ssrf.resolve_public_endpoint` resolves the host and refuses it
   unless every address is publicly routable and the port is a mail port.
2. The TCP socket is opened to one of those validated **IP addresses**, never to the host
   name, so a second DNS answer (rebinding) cannot redirect the connection.
3. TLS is negotiated with ``server_hostname`` set to the host name and full certificate and
   host name verification. Nothing is sent to the server before TLS is up except the
   protocol's own greeting / ``STARTTLS`` exchange; credentials never travel in plaintext.

``imaplib`` and ``smtplib`` are blocking; callers run these functions in a thread. Neither
library follows referrals. Nothing here logs: banners, user names and passwords stay out of
the log by construction.
"""

from __future__ import annotations

import asyncio
import imaplib
import ipaddress
import smtplib
import socket
import ssl
from collections.abc import Callable
from dataclasses import dataclass

from app.core.security.ssrf import (
    ALLOWED_MAIL_PORTS,
    BlockedDestinationError,
    PublicEndpoint,
    Resolver,
    resolve_public_endpoint,
    system_resolver,
    validate_hostname,
)
from app.integrations.email_providers.contracts.errors import (
    ProviderAuthError,
    ProviderDestinationBlocked,
    ProviderError,
    ProviderTlsRequired,
    ProviderUnavailable,
)
from app.integrations.email_providers.contracts.models import (
    MailEndpoint,
    MailSecurity,
    ServerCredentials,
)

IMAP_PORTS = frozenset({143, 993})
SMTP_PORTS = frozenset({465, 587})
if IMAP_PORTS | SMTP_PORTS != ALLOWED_MAIL_PORTS:  # keep in step with the guard
    raise RuntimeError("mail port sets differ from the SSRF guard's allowlist")
# EHLO name. An address literal avoids ``socket.getfqdn()`` (slow, and it would disclose the
# application server's own host name to a server chosen by a user).
EHLO_NAME = "[127.0.0.1]"
# Server replies that mean "try again later", not "wrong password" (RFC 5530 response codes).
_TRANSIENT_CODES = ("[UNAVAILABLE", "[SERVERBUG", "[INUSE", "[LIMIT", "[CONTACTADMIN")

SocketFactory = Callable[[tuple[str, int], float], socket.socket]


def _dial(address: tuple[str, int], timeout: float) -> socket.socket:
    return socket.create_connection(address, timeout)


def _connect_validated(
    endpoint: PublicEndpoint, timeout: float, dial: SocketFactory
) -> socket.socket:
    """Open a TCP connection to one of the validated addresses (tried in order)."""
    last: OSError | None = None
    for address in endpoint.addresses:
        try:
            return dial((address, endpoint.port), timeout)
        except OSError as exc:
            last = exc
    raise last or OSError("no address to connect to")


class _PinnedIMAP4(imaplib.IMAP4):
    """``IMAP4`` whose socket goes to a validated IP; ``self.host`` stays the host name, which
    is what ``starttls`` passes as ``server_hostname``."""

    def __init__(self, endpoint: PublicEndpoint, timeout: float, dial: SocketFactory) -> None:
        self._endpoint = endpoint
        self._dial = dial
        super().__init__(endpoint.host, endpoint.port, timeout=timeout)

    def _create_socket(self, timeout: float | None) -> socket.socket:
        return _connect_validated(self._endpoint, timeout or 10.0, self._dial)


class _PinnedIMAP4SSL(imaplib.IMAP4_SSL):
    def __init__(
        self,
        endpoint: PublicEndpoint,
        timeout: float,
        dial: SocketFactory,
        context: ssl.SSLContext,
    ) -> None:
        self._endpoint = endpoint
        self._dial = dial
        super().__init__(endpoint.host, endpoint.port, ssl_context=context, timeout=timeout)

    def _create_socket(self, timeout: float | None) -> socket.socket:
        raw = _connect_validated(self._endpoint, timeout or 10.0, self._dial)
        try:
            context: ssl.SSLContext = self.ssl_context
            return context.wrap_socket(raw, server_hostname=self._endpoint.host)
        except BaseException:
            raw.close()
            raise


class _PinnedSMTP(smtplib.SMTP):
    def __init__(self, endpoint: PublicEndpoint, timeout: float, dial: SocketFactory) -> None:
        self._endpoint = endpoint
        self._dial = dial
        super().__init__(endpoint.host, endpoint.port, local_hostname=EHLO_NAME, timeout=timeout)

    def _get_socket(self, host: str, port: int, timeout: float) -> socket.socket:
        return _connect_validated(self._endpoint, timeout, self._dial)


class _PinnedSMTPSSL(smtplib.SMTP_SSL):
    def __init__(
        self,
        endpoint: PublicEndpoint,
        timeout: float,
        dial: SocketFactory,
        context: ssl.SSLContext,
    ) -> None:
        self._endpoint = endpoint
        self._dial = dial
        super().__init__(
            endpoint.host,
            endpoint.port,
            local_hostname=EHLO_NAME,
            timeout=timeout,
            context=context,
        )

    def _get_socket(self, host: str, port: int, timeout: float) -> socket.socket:
        raw = _connect_validated(self._endpoint, timeout, self._dial)
        try:
            return self.context.wrap_socket(raw, server_hostname=self._endpoint.host)
        except BaseException:
            raw.close()
            raise


def _is_encrypted(sock: object) -> bool:
    return isinstance(sock, ssl.SSLSocket)


def _imap_auth_error(exc: Exception) -> ProviderError:
    text = str(exc).upper()
    if any(code in text for code in _TRANSIENT_CODES):
        return ProviderUnavailable("imap login temporarily refused")
    return ProviderAuthError("imap login rejected")


@dataclass(frozen=True, slots=True)
class MailConnector:
    """Opens authenticated IMAP / SMTP connections for one set of credentials.

    ``allow_private_networks`` and ``extra_ca_file`` exist for the integration tests' local
    server and are refused by ``Settings`` outside ``ENVIRONMENT=test``. They widen where a
    connection may go and which authority is trusted; TLS and verification are never
    switched off.
    """

    connect_timeout: float = 10.0
    io_timeout: float = 30.0
    allow_private_networks: bool = False
    extra_ca_file: str | None = None
    resolver: Resolver = system_resolver
    dial: SocketFactory = _dial

    def tls_context(self) -> ssl.SSLContext:
        context = ssl.create_default_context()  # CERT_REQUIRED + host name check
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        if self.extra_ca_file:
            context.load_verify_locations(self.extra_ca_file)
        return context

    async def resolve(
        self, endpoint: MailEndpoint, allowed_ports: frozenset[int]
    ) -> PublicEndpoint:
        """Run the SSRF guard. Called before every connect, including reconnects."""
        try:
            if not self.allow_private_networks:
                return await resolve_public_endpoint(
                    endpoint.host,
                    endpoint.port,
                    allowed_ports=allowed_ports,
                    resolver=self.resolver,
                )
            return await self._resolve_unrestricted(endpoint)
        except BlockedDestinationError as exc:
            raise ProviderDestinationBlocked("destination not allowed") from exc

    async def _resolve_unrestricted(self, endpoint: MailEndpoint) -> PublicEndpoint:
        # Test-only path: same resolve-then-pin behaviour, without the public-address and
        # port restrictions.
        host = validate_hostname(endpoint.host)
        if not 0 < endpoint.port < 65536:
            raise BlockedDestinationError("This port is not allowed.")
        try:
            addresses = [str(ipaddress.ip_address(host.strip("[]")))]
        except ValueError:
            try:
                addresses = await self.resolver(host, endpoint.port)
            except OSError as exc:
                raise BlockedDestinationError("The host could not be resolved.") from exc
        if not addresses:
            raise BlockedDestinationError()
        return PublicEndpoint(host, endpoint.port, tuple(dict.fromkeys(addresses)))

    # -- IMAP ------------------------------------------------------------------------------

    def open_imap(self, target: PublicEndpoint, credentials: ServerCredentials) -> imaplib.IMAP4:
        """Blocking. Connect to the validated address, secure the channel, log in."""
        security = credentials.imap.security
        try:
            return self._open_imap(target, security, credentials)
        except ProviderError as exc:
            exc.service = "imap"
            raise

    def _open_imap(
        self, target: PublicEndpoint, security: MailSecurity, credentials: ServerCredentials
    ) -> imaplib.IMAP4:
        context = self.tls_context()
        conn: imaplib.IMAP4 | None = None
        try:
            if security is MailSecurity.SSL:
                conn = _PinnedIMAP4SSL(target, self.connect_timeout, self.dial, context)
            else:
                conn = _PinnedIMAP4(target, self.connect_timeout, self.dial)
                if "STARTTLS" not in conn.capabilities:
                    raise ProviderTlsRequired("imap server does not offer STARTTLS")
                conn.starttls(ssl_context=context)  # re-reads capabilities afterwards
            if not _is_encrypted(conn.sock):
                raise ProviderTlsRequired("imap connection is not encrypted")
            conn.sock.settimeout(self.io_timeout)
            self._imap_login(conn, credentials)
            return conn
        except ProviderError:
            _close_imap(conn)
            raise
        except ssl.SSLError as exc:
            _close_imap(conn)
            raise ProviderUnavailable("imap tls failure") from exc
        except (imaplib.IMAP4.error, OSError, EOFError) as exc:
            _close_imap(conn)
            raise ProviderUnavailable("imap connection failed") from exc

    @staticmethod
    def _imap_login(conn: imaplib.IMAP4, credentials: ServerCredentials) -> None:
        capabilities = {c.upper() for c in conn.capabilities}
        user, password = credentials.username, credentials.password
        try:
            if "AUTH=PLAIN" in capabilities:
                # SASL PLAIN carries UTF-8, unlike LOGIN's quoted ASCII string.
                conn.authenticate("PLAIN", lambda _: f"\0{user}\0{password}".encode())
            elif "LOGINDISABLED" in capabilities:
                raise ProviderAuthError("imap server offers no supported login method")
            else:
                conn.login(user, password)
        except UnicodeEncodeError as exc:
            raise ProviderAuthError("credentials not representable for LOGIN") from exc
        except imaplib.IMAP4.abort as exc:
            raise ProviderUnavailable("imap connection lost during login") from exc
        except imaplib.IMAP4.error as exc:
            raise _imap_auth_error(exc) from exc

    # -- SMTP ------------------------------------------------------------------------------

    def open_smtp(self, target: PublicEndpoint, credentials: ServerCredentials) -> smtplib.SMTP:
        """Blocking. Connect to the validated address, secure the channel, authenticate."""
        try:
            return self._open_smtp(target, credentials)
        except ProviderError as exc:
            exc.service = "smtp"
            raise

    def _open_smtp(self, target: PublicEndpoint, credentials: ServerCredentials) -> smtplib.SMTP:
        context = self.tls_context()
        conn: smtplib.SMTP | None = None
        try:
            if credentials.smtp.security is MailSecurity.SSL:
                conn = _PinnedSMTPSSL(target, self.connect_timeout, self.dial, context)
                conn.ehlo()
            else:
                conn = _PinnedSMTP(target, self.connect_timeout, self.dial)
                conn.ehlo()
                if not conn.has_extn("starttls"):
                    raise ProviderTlsRequired("smtp server does not offer STARTTLS")
                conn.starttls(context=context)
                conn.ehlo()
            if not _is_encrypted(conn.sock):
                raise ProviderTlsRequired("smtp connection is not encrypted")
            if conn.sock is not None:
                conn.sock.settimeout(self.io_timeout)
            if not conn.has_extn("auth"):
                raise ProviderAuthError("smtp server does not offer authentication")
            conn.login(credentials.username, credentials.password)
            return conn
        except ProviderError:
            _close_smtp(conn)
            raise
        except smtplib.SMTPNotSupportedError as exc:
            _close_smtp(conn)
            raise ProviderAuthError("smtp server offers no supported login method") from exc
        except (smtplib.SMTPAuthenticationError, UnicodeEncodeError) as exc:
            _close_smtp(conn)
            raise ProviderAuthError("smtp login rejected") from exc
        except ssl.SSLError as exc:
            _close_smtp(conn)
            raise ProviderUnavailable("smtp tls failure") from exc
        except (smtplib.SMTPException, OSError, EOFError) as exc:
            _close_smtp(conn)
            raise ProviderUnavailable("smtp connection failed") from exc

    # -- both ------------------------------------------------------------------------------

    async def verify(self, credentials: ServerCredentials) -> None:
        """Prove that both servers accept the credentials. Used when connecting a mailbox."""
        # Both destinations are validated before anything is contacted.
        try:
            imap_target = await self.resolve(credentials.imap, IMAP_PORTS)
        except ProviderError as exc:
            exc.service = "imap"
            raise
        try:
            smtp_target = await self.resolve(credentials.smtp, SMTP_PORTS)
        except ProviderError as exc:
            exc.service = "smtp"
            raise
        imap = await asyncio.to_thread(self.open_imap, imap_target, credentials)
        await asyncio.to_thread(_close_imap, imap)
        smtp = await asyncio.to_thread(self.open_smtp, smtp_target, credentials)
        await asyncio.to_thread(_close_smtp, smtp)


def _close_imap(conn: imaplib.IMAP4 | None) -> None:
    if conn is None:
        return
    try:
        conn.logout()
    except (imaplib.IMAP4.error, OSError, EOFError, AttributeError):
        try:
            conn.shutdown()
        except (OSError, AttributeError):
            pass


def _close_smtp(conn: smtplib.SMTP | None) -> None:
    if conn is None:
        return
    try:
        conn.quit()
    except (smtplib.SMTPException, OSError):
        conn.close()


close_imap = _close_imap
close_smtp = _close_smtp
