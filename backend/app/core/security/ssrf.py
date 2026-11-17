"""SSRF guard for user-supplied mail server hosts.

Usage: resolve with :func:`resolve_public_endpoint`, then connect to one of the returned IP
addresses (not to the hostname) and pass the hostname only for TLS SNI / certificate
verification. Connecting to the validated IP is what defeats DNS rebinding. Call it again on
every reconnect.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass

from app.shared.domain.errors import InvalidInputError

ALLOWED_MAIL_PORTS: frozenset[int] = frozenset({143, 993, 465, 587})
IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
Resolver = Callable[[str, int], Awaitable[list[str]]]

# Ranges that ``is_global`` may not exclude on every Python version, listed explicitly.
_EXTRA_BLOCKED = tuple(
    ipaddress.ip_network(n)
    for n in (
        "0.0.0.0/8",
        "100.64.0.0/10",  # CGNAT
        "169.254.0.0/16",  # link-local incl. cloud metadata 169.254.169.254
        "192.0.0.0/24",
        "198.18.0.0/15",
        "224.0.0.0/4",
        "240.0.0.0/4",
        "fd00:ec2::/32",  # AWS IPv6 metadata
        "64:ff9b::/96",  # NAT64
        "2002::/16",  # 6to4
    )
)


class BlockedDestinationError(InvalidInputError):
    code = "blocked_destination"
    default_message = "This server address is not allowed."


@dataclass(frozen=True, slots=True)
class PublicEndpoint:
    host: str
    port: int
    addresses: tuple[str, ...]


def is_public_ip(value: str | IPAddress) -> bool:
    ip = ipaddress.ip_address(value) if isinstance(value, str) else value
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return is_public_ip(ip.ipv4_mapped)
        if ip.sixtofour is not None or ip.teredo is not None:
            return False
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or not ip.is_global
    ):
        return False
    return not any(ip.version == net.version and ip in net for net in _EXTRA_BLOCKED)


async def _system_resolver(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


def _validate_hostname(host: str) -> str:
    host = host.strip().rstrip(".").lower()
    if not host or len(host) > 253 or any(c in host for c in " /@\\#?%\x00"):
        raise BlockedDestinationError("Invalid host name.")
    return host


async def resolve_public_endpoint(
    host: str,
    port: int,
    *,
    allowed_ports: Iterable[int] = ALLOWED_MAIL_PORTS,
    resolver: Resolver = _system_resolver,
    timeout_seconds: float = 5.0,
) -> PublicEndpoint:
    """Resolve ``host`` and require *every* resolved address to be publicly routable."""
    if port not in set(allowed_ports):
        raise BlockedDestinationError("This port is not allowed.")
    host = _validate_hostname(host)
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        addresses = [str(literal)]
    else:
        try:
            addresses = await asyncio.wait_for(resolver(host, port), timeout_seconds)
        except (OSError, TimeoutError) as exc:
            raise BlockedDestinationError("The host could not be resolved.") from exc
    if not addresses or not all(is_public_ip(a) for a in addresses):
        raise BlockedDestinationError()
    return PublicEndpoint(host=host, port=port, addresses=tuple(dict.fromkeys(addresses)))


# Public names for the adapter that connects to the validated address.
system_resolver = _system_resolver
validate_hostname = _validate_hostname
