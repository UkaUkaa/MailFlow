from __future__ import annotations

from app.core.security.html import html_to_text, sanitize_email_html
from app.modules.emails.application.ports import SanitizedBody


class Nh3HtmlSanitizer:
    def sanitize(self, raw_html: str) -> SanitizedBody:
        result = sanitize_email_html(raw_html)
        return SanitizedBody(html=result.html, has_remote_images=result.has_remote_images)

    def to_text(self, sanitized_html: str) -> str:
        return html_to_text(sanitized_html)
