from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Header, Query, Response, UploadFile, status
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError

from app.api.deps import Auth, Svc
from app.api.schemas import (
    AddressModel,
    DraftOut,
    MessageOut,
    ThreadDetailOut,
    ThreadListOut,
    ThreadSummaryOut,
    draft_out,
    message_out,
    thread_out,
)
from app.core.dependencies import SettingsDep
from app.integrations.email_providers.contracts import SendMode, ThreadAction
from app.modules.emails.application.compose import ComposeCommand, UploadedFile
from app.shared.domain.errors import FieldProblem, InvalidInputError, PayloadTooLargeError

threads_router = APIRouter(prefix="/threads", tags=["threads"])
emails_router = APIRouter(prefix="/emails", tags=["emails"])

ActionName = Literal[
    "mark_read", "mark_unread", "star", "unstar", "archive", "unarchive", "trash", "restore",
    "spam", "not_spam",
]  # fmt: skip
ModeName = Literal["new", "reply", "reply_all", "forward"]


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: ActionName


class BulkActionRequest(ActionRequest):
    thread_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


class BulkActionResponse(BaseModel):
    updated: list[uuid.UUID]


class DraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    account_id: uuid.UUID
    to: list[AddressModel] = Field(default_factory=list, max_length=100)
    cc: list[AddressModel] = Field(default_factory=list, max_length=100)
    bcc: list[AddressModel] = Field(default_factory=list, max_length=100)
    subject: str = Field(default="", max_length=998)
    body_html: str = Field(default="", max_length=1_000_000)
    mode: ModeName = "new"
    source_message_id: uuid.UUID | None = None

    def to_command(self) -> ComposeCommand:
        return ComposeCommand(
            account_id=self.account_id,
            to=tuple(a.to_domain() for a in self.to),
            cc=tuple(a.to_domain() for a in self.cc),
            bcc=tuple(a.to_domain() for a in self.bcc),
            subject=self.subject,
            body_html=self.body_html,
            mode=SendMode(self.mode),
            source_message_id=self.source_message_id,
        )


class SendRequest(DraftRequest):
    draft_id: uuid.UUID | None = None
    forward_attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    # Send later: when to send. Without it the user's undo-send window applies.
    send_at: AwareDatetime | None = None

    def to_command(self) -> ComposeCommand:
        base = super().to_command()
        return ComposeCommand(
            account_id=base.account_id,
            to=base.to,
            cc=base.cc,
            bcc=base.bcc,
            subject=base.subject,
            body_html=base.body_html,
            mode=base.mode,
            source_message_id=base.source_message_id,
            draft_id=self.draft_id,
            forward_attachment_ids=tuple(self.forward_attachment_ids),
        )


class SendResponse(BaseModel):
    # "sent": delivered to the provider now. "undoable": held for the undo window.
    # "scheduled": waiting for the time the user picked. The last two carry ``outbox_id``.
    status: Literal["sent", "undoable", "scheduled"]
    message_id: uuid.UUID | None
    thread_id: uuid.UUID | None
    outbox_id: uuid.UUID | None = None
    send_at: datetime | None = None
    undo_seconds: int = 0


# -- threads -------------------------------------------------------------------------------


@threads_router.get("", response_model=ThreadListOut)
async def list_threads(
    auth: Auth,
    svc: Svc,
    view: Annotated[str | None, Query(max_length=16)] = None,
    account_id: uuid.UUID | None = None,
    folder_id: uuid.UUID | None = None,
    unread: bool = False,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
) -> ThreadListOut:
    if account_id is not None:
        await svc.accounts.get(auth.user_id, account_id)  # 404 for foreign accounts
    page = await svc.thread_queries.list(
        auth.user_id,
        view=view,
        account_id=account_id,
        folder_id=folder_id,
        unread_only=unread,
        cursor=cursor,
        limit=limit,
    )
    return ThreadListOut(items=[thread_out(t) for t in page.items], next_cursor=page.next_cursor)


@threads_router.post("/actions", response_model=BulkActionResponse)
async def bulk_action(body: BulkActionRequest, auth: Auth, svc: Svc) -> BulkActionResponse:
    updated = await svc.thread_actions.apply_many(
        auth.user_id, body.thread_ids, ThreadAction(body.action)
    )
    return BulkActionResponse(updated=updated)


@threads_router.get("/{thread_id}", response_model=ThreadDetailOut)
async def get_thread(thread_id: uuid.UUID, auth: Auth, svc: Svc) -> ThreadDetailOut:
    detail = await svc.thread_queries.get_detail(auth.user_id, thread_id)
    return ThreadDetailOut(
        **thread_out(detail.summary).model_dump(),
        messages=[message_out(m) for m in detail.messages],
    )


@threads_router.post("/{thread_id}/actions", response_model=ThreadSummaryOut)
async def thread_action(
    thread_id: uuid.UUID, body: ActionRequest, auth: Auth, svc: Svc
) -> ThreadSummaryOut:
    summary = await svc.thread_actions.apply(auth.user_id, thread_id, ThreadAction(body.action))
    return thread_out(summary)


# -- drafts (declared before /{message_id} so "drafts" is not parsed as an id) ---------------


@emails_router.post("/drafts", response_model=DraftOut, status_code=status.HTTP_201_CREATED)
async def create_draft(body: DraftRequest, auth: Auth, svc: Svc) -> DraftOut:
    return draft_out(await svc.compose.create_draft(auth.user_id, body.to_command()))


@emails_router.get("/drafts/{draft_id}", response_model=DraftOut)
async def get_draft(draft_id: uuid.UUID, auth: Auth, svc: Svc) -> DraftOut:
    return draft_out(await svc.compose.get_draft(auth.user_id, draft_id))


@emails_router.put("/drafts/{draft_id}", response_model=DraftOut)
async def update_draft(draft_id: uuid.UUID, body: DraftRequest, auth: Auth, svc: Svc) -> DraftOut:
    return draft_out(await svc.compose.update_draft(auth.user_id, draft_id, body.to_command()))


@emails_router.delete("/drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(draft_id: uuid.UUID, auth: Auth, svc: Svc) -> None:
    await svc.compose.delete_draft(auth.user_id, draft_id)


# -- sending -------------------------------------------------------------------------------


@emails_router.post("/send", response_model=SendResponse)
async def send_email(
    auth: Auth,
    svc: Svc,
    settings: SettingsDep,
    response: Response,
    payload: Annotated[str, Form(max_length=1_200_000)],
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)],
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> SendResponse:
    try:
        request = SendRequest.model_validate(json.loads(payload))
    except (ValueError, ValidationError) as exc:
        problems = []
        if isinstance(exc, ValidationError):
            problems = [
                FieldProblem(".".join(str(p) for p in err["loc"]), str(err["type"]))
                for err in exc.errors()
            ]
        raise InvalidInputError(problems=problems) from exc
    uploads: list[UploadedFile] = []
    total = 0
    for upload in files or []:
        if len(uploads) >= settings.max_message_attachments:
            raise InvalidInputError(problems=[FieldProblem("files", "too_many_files")])
        content = await upload.read(settings.max_message_attachment_bytes + 1)
        total += len(content)
        if total > settings.max_message_attachment_bytes:
            raise PayloadTooLargeError("Attachments exceed the size limit.")
        uploads.append(
            UploadedFile(
                filename=upload.filename or "attachment",
                mime_type=upload.content_type or "application/octet-stream",
                content=content,
            )
        )
    outcome = await svc.outbox.submit(
        auth.user_id,
        request.to_command(),
        uploads,
        idempotency_key=idempotency_key,
        send_at=request.send_at,
    )
    if outcome.status != "sent":
        response.status_code = status.HTTP_202_ACCEPTED  # accepted, not yet sent
    waiting = outcome.item is not None and outcome.status != "sent"
    return SendResponse(
        status=outcome.status,
        message_id=outcome.message_id,
        thread_id=outcome.thread_id,
        outbox_id=outcome.item.id if outcome.item else None,
        send_at=outcome.item.send_at if outcome.item and waiting else None,
        undo_seconds=outcome.undo_seconds,
    )


# -- single messages -----------------------------------------------------------------------


@emails_router.get("/{message_id}", response_model=MessageOut)
async def get_email(message_id: uuid.UUID, auth: Auth, svc: Svc) -> MessageOut:
    return message_out(await svc.thread_queries.get_message(auth.user_id, message_id))


@emails_router.post("/{message_id}/actions", response_model=MessageOut)
async def email_action(
    message_id: uuid.UUID, body: ActionRequest, auth: Auth, svc: Svc
) -> MessageOut:
    await svc.thread_actions.apply_to_message(auth.user_id, message_id, ThreadAction(body.action))
    return message_out(await svc.thread_queries.get_message(auth.user_id, message_id))
