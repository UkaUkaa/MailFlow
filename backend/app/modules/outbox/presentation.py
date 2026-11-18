from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.api.deps import Auth, Svc
from app.api.schemas import AddressOut, addresses_out
from app.api.timezone import TimeZoneCookie, to_server_time
from app.modules.outbox.domain import OutboxItem

router = APIRouter(prefix="/outbox", tags=["outbox"])


class OutboxItemOut(BaseModel):
    id: uuid.UUID
    account_id: uuid.UUID
    status: Literal["pending", "sending", "sent", "cancelled", "failed"]
    send_at: datetime
    created_at: datetime
    subject: str
    to: list[AddressOut]
    cc: list[AddressOut]
    bcc: list[AddressOut]
    snippet: str
    attachment_count: int
    mode: Literal["new", "reply", "reply_all", "forward"]
    error_code: str | None


class OutboxFileOut(BaseModel):
    filename: str
    mime_type: str
    size: int


class OutboxDetailOut(OutboxItemOut):
    body_html: str
    source_message_id: uuid.UUID | None
    draft_id: uuid.UUID | None
    forward_attachment_ids: list[uuid.UUID]
    attachments: list[OutboxFileOut]


class OutboxListOut(BaseModel):
    items: list[OutboxItemOut]


class RescheduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    send_at: datetime  # UTC offset, or local time in the ``mf_tz`` cookie zone


def item_out(item: OutboxItem) -> OutboxItemOut:
    content = item.content
    return OutboxItemOut(
        id=item.id,
        account_id=item.account_id,
        status=item.status.value,
        send_at=item.send_at,
        created_at=item.created_at,
        subject=content.subject,
        to=addresses_out(content.to),
        cc=addresses_out(content.cc),
        bcc=addresses_out(content.bcc),
        snippet=item.snippet,
        attachment_count=item.attachment_count,
        mode=content.mode.value,
        error_code=item.error_code,
    )


def detail_out(item: OutboxItem) -> OutboxDetailOut:
    content = item.content
    return OutboxDetailOut(
        **item_out(item).model_dump(),
        body_html=content.body_html,
        source_message_id=content.source_message_id,
        draft_id=content.draft_id,
        forward_attachment_ids=list(content.forward_attachment_ids),
        attachments=[
            OutboxFileOut(filename=a.filename, mime_type=a.mime_type, size=a.size)
            for a in item.attachments
        ],
    )


@router.get("", response_model=OutboxListOut)
async def list_outbox(auth: Auth, svc: Svc) -> OutboxListOut:
    return OutboxListOut(items=[item_out(i) for i in await svc.outbox.list(auth.user_id)])


@router.get("/{outbox_id}", response_model=OutboxDetailOut)
async def get_outbox_item(outbox_id: uuid.UUID, auth: Auth, svc: Svc) -> OutboxDetailOut:
    return detail_out(await svc.outbox.get(auth.user_id, outbox_id))


@router.patch("/{outbox_id}", response_model=OutboxItemOut)
async def reschedule_outbox_item(
    outbox_id: uuid.UUID,
    body: RescheduleRequest,
    auth: Auth,
    svc: Svc,
    time_zone: TimeZoneCookie = None,
) -> OutboxItemOut:
    send_at = to_server_time(body.send_at, time_zone)
    return item_out(await svc.outbox.reschedule(auth.user_id, outbox_id, send_at))


@router.post("/{outbox_id}/cancel", response_model=OutboxDetailOut)
async def cancel_outbox_item(outbox_id: uuid.UUID, auth: Auth, svc: Svc) -> OutboxDetailOut:
    return detail_out(await svc.outbox.cancel(auth.user_id, outbox_id))
