"""Composing: send, reply, reply-all, forward, and provider-backed drafts."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field

from app.integrations.email_providers.contracts import (
    Address,
    EmailProvider,
    OutgoingAttachment,
    OutgoingMessage,
    ProviderError,
    ProviderNotFound,
    SendMode,
    SentMessage,
)
from app.modules.attachments.application import AttachmentNormalizer, AttachmentService
from app.modules.email_accounts.application.sessions import ProviderSession, ProviderSessionFactory
from app.modules.emails.application.ingestion import MessageIngestor
from app.modules.emails.application.ports import HtmlSanitizer, MailRepository
from app.modules.emails.domain.entities import DraftMeta, Message
from app.shared.application.ports import AuditLog, IdempotencyStore, RateLimiter
from app.shared.domain.errors import (
    ConflictError,
    DomainError,
    FieldProblem,
    InvalidInputError,
    NotFoundError,
    PayloadTooLargeError,
    UnsupportedError,
)

MAX_RECIPIENTS = 100
MAX_SUBJECT = 998
MAX_BODY_CHARS = 1_000_000
IDEMPOTENCY_TTL = 24 * 3600


@dataclass(frozen=True, slots=True)
class UploadedFile:
    filename: str
    mime_type: str
    content: bytes = field(repr=False)


@dataclass(frozen=True, slots=True)
class ComposeCommand:
    account_id: uuid.UUID
    to: tuple[Address, ...]
    cc: tuple[Address, ...]
    bcc: tuple[Address, ...]
    subject: str
    body_html: str
    mode: SendMode = SendMode.NEW
    source_message_id: uuid.UUID | None = None
    draft_id: uuid.UUID | None = None
    forward_attachment_ids: tuple[uuid.UUID, ...] = ()


@dataclass(frozen=True, slots=True)
class SendResult:
    message_id: uuid.UUID | None
    thread_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class ComposeLimits:
    max_attachment_bytes: int
    max_attachments: int


class ComposeService:
    def __init__(
        self,
        mail: MailRepository,
        sessions: ProviderSessionFactory,
        ingestor: MessageIngestor,
        attachments: AttachmentService,
        sanitizer: HtmlSanitizer,
        normalizer: AttachmentNormalizer,
        idempotency: IdempotencyStore,
        limiter: RateLimiter,
        audit: AuditLog,
        limits: ComposeLimits,
    ) -> None:
        self._mail = mail
        self._sessions = sessions
        self._ingestor = ingestor
        self._attachments = attachments
        self._sanitizer = sanitizer
        self._normalizer = normalizer
        self._idempotency = idempotency
        self._limiter = limiter
        self._audit = audit
        self._limits = limits

    # -- helpers ---------------------------------------------------------------------------

    def _validate(self, command: ComposeCommand, *, sending: bool) -> None:
        recipients = len(command.to) + len(command.cc) + len(command.bcc)
        if sending and recipients == 0:
            raise InvalidInputError(problems=[FieldProblem("to", "recipient_required")])
        if recipients > MAX_RECIPIENTS:
            raise InvalidInputError(problems=[FieldProblem("to", "too_many_recipients")])
        if len(command.subject) > MAX_SUBJECT:
            raise InvalidInputError(problems=[FieldProblem("subject", "too_long")])
        if len(command.body_html) > MAX_BODY_CHARS:
            raise PayloadTooLargeError("The message body is too large.")
        if command.mode is not SendMode.NEW and command.source_message_id is None and sending:
            raise InvalidInputError(problems=[FieldProblem("source_message_id", "required")])

    async def _source(self, user_id: uuid.UUID, command: ComposeCommand) -> Message | None:
        if command.source_message_id is None or command.mode is SendMode.NEW:
            return None
        source = await self._mail.get_message(user_id, command.source_message_id)
        # Replies must go out from the mailbox that holds the original message.
        if source is None or source.account_id != command.account_id:
            raise NotFoundError("The original message was not found.")
        return source

    async def _outgoing(
        self,
        user_id: uuid.UUID,
        command: ComposeCommand,
        session: ProviderSession,
        attachments: tuple[OutgoingAttachment, ...] = (),
    ) -> OutgoingMessage:
        source = await self._source(user_id, command)
        html = self._sanitizer.sanitize(command.body_html).html
        thread_id = in_reply_to = references = None
        if source is not None and command.mode in (SendMode.REPLY, SendMode.REPLY_ALL):
            source_thread = await self._mail.get_thread(user_id, source.thread_id)
            thread_id = source_thread.provider_thread_id if source_thread else None
            in_reply_to = source.rfc822_message_id
            references = (
                " ".join(part for part in (source.references, source.rfc822_message_id) if part)
                or None
            )
        account = session.account
        return OutgoingMessage(
            sender=Address(email=account.email_address, name=None),
            to=command.to,
            cc=command.cc,
            bcc=command.bcc,
            subject=command.subject,
            body_html=html,
            body_text=self._sanitizer.to_text(html),
            attachments=attachments,
            provider_thread_id=thread_id,
            in_reply_to=in_reply_to,
            references=references,
        )

    async def _collect_attachments(
        self, user_id: uuid.UUID, command: ComposeCommand, files: list[UploadedFile]
    ) -> tuple[OutgoingAttachment, ...]:
        if len(files) + len(command.forward_attachment_ids) > self._limits.max_attachments:
            raise InvalidInputError(problems=[FieldProblem("files", "too_many_files")])
        collected = [
            OutgoingAttachment(
                filename=self._normalizer.filename(f.filename),
                mime_type=self._normalizer.mime_type(f.mime_type),
                content=f.content,
            )
            for f in files
        ]
        for attachment_id in command.forward_attachment_ids:
            meta = await self._attachments.get(user_id, attachment_id)
            if command.source_message_id is None or meta.message_id != command.source_message_id:
                raise NotFoundError("The attachment does not belong to the forwarded message.")
            meta, content = await self._attachments.download(user_id, attachment_id)
            collected.append(OutgoingAttachment(meta.filename, meta.mime_type, content))
        if sum(len(a.content) for a in collected) > self._limits.max_attachment_bytes:
            raise PayloadTooLargeError("Attachments exceed the size limit.")
        return tuple(collected)

    async def _ingest_remote(
        self,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        provider: EmailProvider,
        provider_message_id: str,
    ) -> uuid.UUID | None:
        try:
            remote = await provider.get_message(provider_message_id)
        except ProviderError:
            return None  # the next synchronization will pick it up
        ids = await self._ingestor.ingest(user_id, account_id, [remote])
        return ids[0] if ids else None

    # -- sending ---------------------------------------------------------------------------

    async def send(
        self,
        user_id: uuid.UUID,
        command: ComposeCommand,
        files: list[UploadedFile],
        *,
        idempotency_key: str,
    ) -> SendResult:
        """Send a message exactly once per idempotency key."""
        if not 8 <= len(idempotency_key) <= 128:
            raise InvalidInputError("A valid Idempotency-Key header is required.")
        self._validate(command, sending=True)
        await self._limiter.hit(f"send:{user_id}", limit=60, window_seconds=3600)
        key = f"mf:u:{user_id}:idem:send:{idempotency_key}"
        previous = await self._idempotency.begin(key, ttl_seconds=IDEMPOTENCY_TTL)
        if previous is not None:
            if previous == "":
                raise ConflictError("This message is already being sent.", code="send_in_progress")
            stored = json.loads(previous)
            return SendResult(
                uuid.UUID(stored["m"]) if stored["m"] else None,
                uuid.UUID(stored["t"]) if stored["t"] else None,
            )
        try:
            result = await self._send(user_id, command, files)
        except BaseException:
            # Nothing was sent (or the outcome is unknown): free the key so a retry can proceed.
            await self._idempotency.release(key)
            raise
        await self._idempotency.complete(
            key,
            json.dumps(
                {
                    "m": str(result.message_id) if result.message_id else None,
                    "t": str(result.thread_id) if result.thread_id else None,
                }
            ),
            ttl_seconds=IDEMPOTENCY_TTL,
        )
        return result

    async def _send(
        self, user_id: uuid.UUID, command: ComposeCommand, files: list[UploadedFile]
    ) -> SendResult:
        draft = await self._draft(user_id, command.draft_id) if command.draft_id else None
        async with self._sessions.open(user_id, command.account_id) as session:
            attachments = await self._collect_attachments(user_id, command, files)
            outgoing = await self._outgoing(user_id, command, session, attachments)
            sent: SentMessage
            if command.mode in (SendMode.REPLY, SendMode.REPLY_ALL):
                sent = await session.provider.reply_message(outgoing)
            elif command.mode is SendMode.FORWARD:
                sent = await session.provider.forward_message(outgoing)
            else:
                sent = await session.provider.send_message(outgoing)
            # From here on the message is out; follow-up failures must not surface as errors.
            if draft is not None:
                try:
                    if draft.provider_draft_id:
                        await session.provider.delete_draft(draft.provider_draft_id)
                except (ProviderError, DomainError):
                    pass
                await self._mail.delete_message(user_id, draft.id)
                await self._ingestor.refresh_threads(user_id, [draft.thread_id])
            message_id = await self._ingest_remote(
                user_id, command.account_id, session.provider, sent.provider_message_id
            )
        await self._audit.record("mail.sent", user_id=user_id)
        thread_id = None
        if message_id is not None:
            stored = await self._mail.get_message(user_id, message_id)
            thread_id = stored.thread_id if stored else None
        return SendResult(message_id, thread_id)

    # -- drafts ----------------------------------------------------------------------------

    async def _draft(self, user_id: uuid.UUID, draft_id: uuid.UUID) -> Message:
        message = await self._mail.get_message(user_id, draft_id)
        if message is None or not message.flags.is_draft:
            raise NotFoundError
        return message

    async def get_draft(self, user_id: uuid.UUID, draft_id: uuid.UUID) -> Message:
        return await self._draft(user_id, draft_id)

    async def create_draft(self, user_id: uuid.UUID, command: ComposeCommand) -> Message:
        self._validate(command, sending=False)
        async with self._sessions.open(user_id, command.account_id) as session:
            if not session.provider.capabilities.drafts:
                raise UnsupportedError
            outgoing = await self._outgoing(user_id, command, session)
            remote = await session.provider.create_draft(outgoing)
            message_id = await self._ingest_remote(
                user_id, command.account_id, session.provider, remote.provider_message_id
            )
        if message_id is None:
            raise ConflictError("The draft was saved but is not available yet.")
        await self._mail.repoint_draft(
            user_id,
            message_id,
            provider_message_id=remote.provider_message_id,
            provider_draft_id=remote.provider_draft_id,
        )
        await self._mail.set_draft_meta(
            user_id, message_id, DraftMeta(command.mode.value, command.source_message_id)
        )
        return await self._draft(user_id, message_id)

    async def update_draft(
        self, user_id: uuid.UUID, draft_id: uuid.UUID, command: ComposeCommand
    ) -> Message:
        self._validate(command, sending=False)
        draft = await self._draft(user_id, draft_id)
        if draft.account_id != command.account_id:
            raise InvalidInputError("A draft cannot be moved to another account.")
        if not draft.provider_draft_id:
            raise ConflictError("This draft cannot be edited here yet.")
        async with self._sessions.open(user_id, draft.account_id) as session:
            outgoing = await self._outgoing(user_id, command, session)
            remote = await session.provider.update_draft(draft.provider_draft_id, outgoing)
            # The provider gives the edited draft a new message id; keep our row (and the
            # id the client holds) by re-pointing it before ingesting the new content.
            await self._mail.repoint_draft(
                user_id,
                draft.id,
                provider_message_id=remote.provider_message_id,
                provider_draft_id=remote.provider_draft_id,
            )
            await self._ingest_remote(
                user_id, draft.account_id, session.provider, remote.provider_message_id
            )
        await self._mail.set_draft_meta(
            user_id, draft.id, DraftMeta(command.mode.value, command.source_message_id)
        )
        return await self._draft(user_id, draft.id)

    async def delete_draft(self, user_id: uuid.UUID, draft_id: uuid.UUID) -> None:
        draft = await self._draft(user_id, draft_id)
        async with self._sessions.open(user_id, draft.account_id) as session:
            if draft.provider_draft_id:
                try:
                    await session.provider.delete_draft(draft.provider_draft_id)
                except ProviderNotFound:
                    pass  # already gone at the provider
        await self._mail.delete_message(user_id, draft.id)
        await self._ingestor.refresh_threads(user_id, [draft.thread_id])
