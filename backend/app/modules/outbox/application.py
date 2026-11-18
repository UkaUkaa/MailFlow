"""Scheduled outbox use cases.

``OutboxService`` runs in the API: it accepts a send for later (a time the user picked, or the
undo window), lists, reschedules and cancels. ``OutboxDispatcher`` runs in a worker: it claims
one due item and sends it through the ordinary compose path, reusing that path's idempotency
key so a redelivered task or a second worker can never deliver the message twice.
"""

from __future__ import annotations

import builtins
import math
import uuid
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

from app.modules.emails.application.compose import (
    ComposeCommand,
    ComposeService,
    UploadedFile,
    check_idempotency_key,
)
from app.modules.outbox.domain import (
    DIRECT_ENQUEUE_WINDOW,
    MAX_ACTIVE_ITEMS,
    MAX_ATTEMPTS,
    MAX_SCHEDULE_AHEAD,
    OVERDUE_AFTER,
    OutboxContent,
    OutboxFile,
    OutboxFileMeta,
    OutboxItem,
    OutboxKind,
    OutboxStatus,
    retry_delay,
)
from app.modules.settings.application import SettingsService
from app.shared.application.ports import AuditLog, Clock
from app.shared.domain.errors import (
    ConflictError,
    DomainError,
    FieldProblem,
    InvalidInputError,
    NotFoundError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
)

SNIPPET_CHARS = 200
_TRANSIENT = (ProviderUnavailableError, ProviderRateLimitedError)


class OutboxRepository(Protocol):
    async def insert(
        self,
        item: OutboxItem,
        files: builtins.list[OutboxFile],
        *,
        enqueued_until: datetime | None,
    ) -> bool:
        """Store a new item. False when the user already has one with this idempotency key."""

    async def get(
        self, user_id: uuid.UUID, outbox_id: uuid.UUID, *, for_update: bool = False
    ) -> OutboxItem | None: ...
    async def get_by_key(self, user_id: uuid.UUID, idempotency_key: str) -> OutboxItem | None: ...
    async def list_visible(
        self, user_id: uuid.UUID, *, overdue_before: datetime
    ) -> builtins.list[OutboxItem]:
        """Scheduled and failed items, plus undo-window items that are overdue."""

    async def count_active(self, user_id: uuid.UUID) -> int: ...
    async def files(
        self, user_id: uuid.UUID, outbox_id: uuid.UUID
    ) -> builtins.list[OutboxFile]: ...
    async def reschedule(
        self,
        user_id: uuid.UUID,
        outbox_id: uuid.UUID,
        *,
        send_at: datetime,
        enqueued_until: datetime | None,
    ) -> None: ...
    async def claim(
        self, user_id: uuid.UUID, outbox_id: uuid.UUID, *, now: datetime, locked_until: datetime
    ) -> OutboxItem | None:
        """Atomically move a due item to ``sending``. None when it is not due, not pending,
        cancelled, or held by another worker whose lease has not expired."""

    async def mark_sent(
        self,
        user_id: uuid.UUID,
        outbox_id: uuid.UUID,
        *,
        message_id: uuid.UUID | None,
        thread_id: uuid.UUID | None,
        now: datetime,
    ) -> None: ...
    async def mark_cancelled(self, user_id: uuid.UUID, outbox_id: uuid.UUID) -> None: ...
    async def mark_failed(
        self, user_id: uuid.UUID, outbox_id: uuid.UUID, error_code: str
    ) -> None: ...
    async def retry_later(
        self,
        user_id: uuid.UUID,
        outbox_id: uuid.UUID,
        *,
        next_attempt_at: datetime,
        error_code: str,
    ) -> None: ...


class OutboxQueue(Protocol):
    def enqueue(self, user_id: uuid.UUID, outbox_id: uuid.UUID, *, countdown: int = 0) -> None:
        """Ask a worker to send the item. Identifiers only."""


@dataclass(frozen=True, slots=True)
class Submission:
    """What happened to a send request: sent now, held for undo, or scheduled."""

    status: str  # "sent" | "undoable" | "scheduled"
    message_id: uuid.UUID | None = None
    thread_id: uuid.UUID | None = None
    item: OutboxItem | None = None
    undo_seconds: int = 0


def _countdown(now: datetime, due: datetime) -> int:
    return max(0, math.ceil((due - now).total_seconds()))


class OutboxService:
    def __init__(
        self,
        repository: OutboxRepository,
        compose: ComposeService,
        settings: SettingsService,
        queue: OutboxQueue,
        audit: AuditLog,
        clock: Clock,
    ) -> None:
        self._repo = repository
        self._compose = compose
        self._settings = settings
        self._queue = queue
        self._audit = audit
        self._clock = clock

    def _check_time(self, send_at: datetime, now: datetime) -> None:
        if send_at <= now:
            raise InvalidInputError(problems=[FieldProblem("send_at", "in_past")])
        if send_at - now > MAX_SCHEDULE_AHEAD:
            raise InvalidInputError(problems=[FieldProblem("send_at", "too_far")])

    def _replay(self, item: OutboxItem, now: datetime) -> Submission:
        if item.status is OutboxStatus.CANCELLED:
            raise ConflictError("This send was cancelled.", code="send_cancelled")
        if item.status is OutboxStatus.SENT:
            return Submission("sent", item.message_id, item.thread_id, item)
        if item.kind is OutboxKind.UNDO:
            return Submission("undoable", item=item, undo_seconds=_countdown(now, item.send_at))
        return Submission("scheduled", item=item)

    def _enqueue_if_soon(self, item_id: uuid.UUID, user_id: uuid.UUID, now: datetime,
                         due: datetime) -> None:  # fmt: skip
        if due - now <= DIRECT_ENQUEUE_WINDOW:
            self._queue.enqueue(user_id, item_id, countdown=_countdown(now, due))

    @staticmethod
    def _enqueued_until(now: datetime, due: datetime) -> datetime | None:
        """While a directly enqueued task is on its way the beat scan leaves the item alone."""
        return due + DIRECT_ENQUEUE_WINDOW if due - now <= DIRECT_ENQUEUE_WINDOW else None

    async def submit(
        self,
        user_id: uuid.UUID,
        command: ComposeCommand,
        files: builtins.list[UploadedFile],
        *,
        idempotency_key: str,
        send_at: datetime | None = None,
    ) -> Submission:
        """Send now, or accept the message for later.

        With ``send_at`` the message is scheduled. Without it the user's undo window decides:
        off sends immediately, otherwise the message waits ``undo_send_seconds`` in the outbox.
        Repeating a request with the same idempotency key returns the first outcome.
        """
        check_idempotency_key(idempotency_key)
        now = self._clock.now()
        existing = await self._repo.get_by_key(user_id, idempotency_key)
        if existing is not None:
            return self._replay(existing, now)
        undo_seconds = 0
        if send_at is None:
            undo_seconds = (await self._settings.get(user_id)).undo_send_seconds
            if undo_seconds == 0:
                result = await self._compose.send(
                    user_id, command, files, idempotency_key=idempotency_key
                )
                return Submission("sent", result.message_id, result.thread_id)
            kind, due = OutboxKind.UNDO, now + timedelta(seconds=undo_seconds)
        else:
            self._check_time(send_at, now)
            kind, due = OutboxKind.SCHEDULED, send_at
        await self._compose.preflight(user_id, command, files)
        if await self._repo.count_active(user_id) >= MAX_ACTIVE_ITEMS:
            raise ConflictError("Too many messages are waiting to be sent.",
                                code="too_many_scheduled")  # fmt: skip
        html, text = self._compose.clean_body(command.body_html)
        item = OutboxItem(
            id=uuid.uuid4(),
            user_id=user_id,
            account_id=command.account_id,
            kind=kind,
            status=OutboxStatus.PENDING,
            send_at=due,
            idempotency_key=idempotency_key,
            content=OutboxContent(
                to=command.to,
                cc=command.cc,
                bcc=command.bcc,
                subject=command.subject,
                body_html=html,
                mode=command.mode,
                source_message_id=command.source_message_id,
                draft_id=command.draft_id,
                forward_attachment_ids=command.forward_attachment_ids,
            ),
            snippet=" ".join(text.split())[:SNIPPET_CHARS],
            created_at=now,
            attachments=tuple(
                OutboxFileMeta(f.filename, f.mime_type, len(f.content)) for f in files
            ),
        )
        stored = [OutboxFile(f.filename, f.mime_type, f.content) for f in files]
        if not await self._repo.insert(item, stored, enqueued_until=self._enqueued_until(now, due)):
            # A concurrent request with the same key won the insert.
            winner = await self._repo.get_by_key(user_id, idempotency_key)
            if winner is None:
                raise ConflictError("This message is already being sent.", code="send_in_progress")
            return self._replay(winner, now)
        self._enqueue_if_soon(item.id, user_id, now, due)
        await self._audit.record("mail.send_queued", user_id=user_id, metadata={"kind": kind.value})
        if kind is OutboxKind.UNDO:
            return Submission("undoable", item=item, undo_seconds=undo_seconds)
        return Submission("scheduled", item=item)

    async def list(self, user_id: uuid.UUID) -> builtins.list[OutboxItem]:
        return await self._repo.list_visible(
            user_id, overdue_before=self._clock.now() - OVERDUE_AFTER
        )

    async def get(self, user_id: uuid.UUID, outbox_id: uuid.UUID) -> OutboxItem:
        item = await self._repo.get(user_id, outbox_id)
        if item is None:
            raise NotFoundError
        return item

    async def reschedule(
        self, user_id: uuid.UUID, outbox_id: uuid.UUID, send_at: datetime
    ) -> OutboxItem:
        """Move a waiting item to another time; a failed item is queued again."""
        item = await self._repo.get(user_id, outbox_id, for_update=True)
        if item is None:
            raise NotFoundError
        if not item.can_reschedule:
            raise ConflictError("This message can no longer be rescheduled.",
                                code="outbox_not_editable")  # fmt: skip
        now = self._clock.now()
        self._check_time(send_at, now)
        await self._repo.reschedule(
            user_id, outbox_id, send_at=send_at, enqueued_until=self._enqueued_until(now, send_at)
        )
        self._enqueue_if_soon(outbox_id, user_id, now, send_at)
        return await self.get(user_id, outbox_id)

    async def cancel(self, user_id: uuid.UUID, outbox_id: uuid.UUID) -> OutboxItem:
        """Stop a waiting send. Returns the full content so the composer can reopen it; the
        stored copy (body, attachments) is erased."""
        item = await self._repo.get(user_id, outbox_id, for_update=True)
        if item is None:
            raise NotFoundError
        if not item.can_cancel:
            raise ConflictError("This message has already been sent.",
                                code="outbox_not_cancellable")  # fmt: skip
        await self._repo.mark_cancelled(user_id, outbox_id)
        await self._audit.record("mail.send_cancelled", user_id=user_id)
        item.status = OutboxStatus.CANCELLED
        return item


@dataclass(frozen=True, slots=True)
class OutboxScope:
    """Collaborators bound to one tenant transaction in the worker."""

    outbox: OutboxRepository
    compose: ComposeService
    owner_is_active: Callable[[uuid.UUID], Awaitable[bool]]


OutboxUnitOfWork = Callable[[uuid.UUID], AbstractAsyncContextManager[OutboxScope]]


class OutboxDispatcher:
    """Sends one outbox item. Safe to run twice for the same item, concurrently or not."""

    def __init__(self, unit_of_work: OutboxUnitOfWork, clock: Clock, lease: timedelta) -> None:
        self._uow = unit_of_work
        self._clock = clock
        self._lease = lease

    async def run(self, user_id: uuid.UUID, outbox_id: uuid.UUID) -> str:
        # 1. Claim in its own short transaction: exactly one caller gets the item, and the
        #    committed ``sending`` state stops a late cancel from racing the provider call.
        async with self._uow(user_id) as scope:
            if not await scope.owner_is_active(user_id):
                return "skipped"
            now = self._clock.now()
            item = await scope.outbox.claim(
                user_id, outbox_id, now=now, locked_until=now + self._lease
            )
        if item is None:
            return "skipped"
        # 2. Send. The account is re-read and its credentials come from the Token Vault inside
        #    the compose path; nothing but the two ids reached this worker.
        try:
            async with self._uow(user_id) as scope:
                await self._send(scope, item)
            return "sent"
        except DomainError as exc:
            return await self._settle(item, exc)
        except Exception:
            await self._fail(item, "internal_error")
            raise

    async def _send(self, scope: OutboxScope, item: OutboxItem) -> None:
        content = item.content
        draft_id = content.draft_id
        if draft_id and not await scope.compose.draft_exists(item.user_id, draft_id):
            draft_id = None  # the user deleted the draft meanwhile; the message still goes out
        command = ComposeCommand(
            account_id=item.account_id,
            to=content.to,
            cc=content.cc,
            bcc=content.bcc,
            subject=content.subject,
            body_html=content.body_html,
            mode=content.mode,
            source_message_id=content.source_message_id,
            draft_id=draft_id,
            forward_attachment_ids=content.forward_attachment_ids,
        )
        files = [
            UploadedFile(f.filename, f.mime_type, f.content)
            for f in await scope.outbox.files(item.user_id, item.id)
        ]
        result = await scope.compose.send(
            item.user_id,
            command,
            files,
            idempotency_key=item.idempotency_key,
            rate_limited=False,
        )
        await scope.outbox.mark_sent(
            item.user_id,
            item.id,
            message_id=result.message_id,
            thread_id=result.thread_id,
            now=self._clock.now(),
        )

    async def _settle(self, item: OutboxItem, exc: DomainError) -> str:
        """Record a send that did not go through, in a fresh transaction."""
        attempts_left = item.attempts < MAX_ATTEMPTS
        if isinstance(exc, ConflictError) and exc.code == "send_in_progress":
            # Another worker holds the idempotency key: it is sending right now, or it died
            # mid-send. Sending again could deliver twice, so wait for the lease and, if the
            # key never resolves, give up rather than guess.
            if attempts_left:
                return "in_progress"
            await self._fail(item, "outcome_unknown")
            return "failed"
        if isinstance(exc, _TRANSIENT) and attempts_left:
            async with self._uow(item.user_id) as scope:
                await scope.outbox.retry_later(
                    item.user_id,
                    item.id,
                    next_attempt_at=self._clock.now() + retry_delay(item.attempts),
                    error_code=exc.code,
                )
            return "retry"
        await self._fail(item, exc.code)
        return "failed"

    async def _fail(self, item: OutboxItem, error_code: str) -> None:
        async with self._uow(item.user_id) as scope:
            await scope.outbox.mark_failed(item.user_id, item.id, error_code)


__all__ = [
    "OutboxDispatcher",
    "OutboxQueue",
    "OutboxRepository",
    "OutboxScope",
    "OutboxService",
    "Submission",
]
