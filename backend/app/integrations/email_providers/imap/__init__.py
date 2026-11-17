"""Generic IMAP + SMTP adapter for password-based mailboxes.

``transport`` — guarded connections (SSRF guard, validated IP, verified TLS);
``mailbox`` — folders, ids, cursor; ``mime`` — parsing and building; ``provider`` — the adapter.
"""

from app.integrations.email_providers.imap.provider import IMAP_CAPABILITIES, ImapProvider
from app.integrations.email_providers.imap.transport import MailConnector

__all__ = ["IMAP_CAPABILITIES", "ImapProvider", "MailConnector"]
