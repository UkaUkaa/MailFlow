"""Single entry point through which provider messages enter MailFlow's storage."""

from __future__ import annotations

import uuid

from app.integrations.email_providers.contracts import ProviderMessage
from app.modules.attachments.application import AttachmentService
from app.modules.emails.application.ports import HtmlSanitizer, MailRepository
from app.modules.emails.domain.entities import MessageFlags, StoredMessage, compute_thread_state

MAX_TEXT_CHARS = 500_000
MAX_SNIPPET_CHARS = 300


class MessageIngestor:
    """Normalizes, sanitizes and upserts messages, then refreshes affected thread summaries.

    Every body is sanitized here, whatever provider it came from, so unsanitized HTML can
    never reach the database. Upserts are keyed on (account, provider message id), which makes
    ingestion idempotent: replaying a sync page changes nothing.
    """

    def __init__(
        self, mail: MailRepository, attachments: AttachmentService, sanitizer: HtmlSanitizer
    ) -> None:
        self._mail = mail
        self._attachments = attachments
        self._sanitizer = sanitizer

    def _normalize(self, message: ProviderMessage) -> StoredMessage:
        html: str | None = None
        remote = False
        text = (message.body_text or "")[:MAX_TEXT_CHARS] or None
        if message.body_html:
            sanitized = self._sanitizer.sanitize(message.body_html)
            html, remote = sanitized.html, sanitized.has_remote_images
            if text is None:
                text = self._sanitizer.to_text(html)[:MAX_TEXT_CHARS] or None
        return StoredMessage(
            provider_message_id=message.provider_message_id,
            provider_draft_id=message.provider_draft_id,
            sender=message.sender,
            to=message.to,
            cc=message.cc,
            bcc=message.bcc,
            reply_to=message.reply_to,
            subject=message.subject.replace("\x00", ""),
            snippet=message.snippet.replace("\x00", "")[:MAX_SNIPPET_CHARS],
            sent_at=message.sent_at,
            flags=MessageFlags.from_roles(
                message.roles,
                is_read=message.is_read,
                is_starred=message.is_starred,
                is_draft=message.is_draft,
            ),
            folder_ids=message.folder_ids,
            rfc822_message_id=(message.rfc822_message_id or "")[:998] or None,
            in_reply_to=(message.in_reply_to or "")[:998] or None,
            references=message.references,
            has_attachments=any(not a.is_inline for a in message.attachments),
            size_estimate=message.size_estimate,
            body_html=html.replace("\x00", "") if html else None,
            body_text=text.replace("\x00", "") if text else None,
            has_remote_images=remote,
        )

    async def ingest(
        self, user_id: uuid.UUID, account_id: uuid.UUID, messages: list[ProviderMessage]
    ) -> list[uuid.UUID]:
        touched: dict[uuid.UUID, None] = {}
        message_ids: list[uuid.UUID] = []
        for message in messages:
            thread_id = await self._mail.upsert_thread(
                user_id, account_id, message.provider_thread_id
            )
            message_id = await self._mail.upsert_message(
                user_id, account_id, thread_id, self._normalize(message)
            )
            await self._attachments.index(
                user_id=user_id,
                account_id=account_id,
                message_id=message_id,
                provider_message_id=message.provider_message_id,
                attachments=message.attachments,
            )
            touched[thread_id] = None
            message_ids.append(message_id)
        await self.refresh_threads(user_id, list(touched))
        if messages:
            await self._mail.delete_empty_threads(user_id, account_id)
        return message_ids

    async def remove(
        self, user_id: uuid.UUID, account_id: uuid.UUID, provider_message_ids: list[str]
    ) -> None:
        if not provider_message_ids:
            return
        threads = await self._mail.delete_by_provider_ids(user_id, account_id, provider_message_ids)
        await self.refresh_threads(user_id, threads)

    async def relocate(
        self, user_id: uuid.UUID, account_id: uuid.UUID, old_id: str, new_id: str
    ) -> None:
        """A provider action gave a message a new id (IMAP move): keep the stored row."""
        await self._mail.relocate_message(user_id, account_id, old_id, new_id)
        await self._attachments.relocate(user_id, account_id, old_id, new_id)

    async def purge_account(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        await self._mail.purge_account(user_id, account_id)

    async def refresh_threads(self, user_id: uuid.UUID, thread_ids: list[uuid.UUID]) -> None:
        for thread_id in dict.fromkeys(thread_ids):
            states = await self._mail.message_states(user_id, thread_id)
            await self._mail.save_thread_state(user_id, thread_id, compute_thread_state(states))
