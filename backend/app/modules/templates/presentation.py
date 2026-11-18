from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import Auth, Svc
from app.modules.templates.domain import (
    MAX_NAME_LENGTH,
    MAX_SUBJECT_LENGTH,
    Template,
    TemplateContent,
)

router = APIRouter(prefix="/templates", tags=["templates"])


class TemplateOut(BaseModel):
    id: uuid.UUID
    name: str
    subject: str
    body_html: str
    created_at: datetime
    updated_at: datetime


class TemplateListOut(BaseModel):
    items: list[TemplateOut]


class TemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(max_length=MAX_NAME_LENGTH * 2)
    subject: str = Field(default="", max_length=MAX_SUBJECT_LENGTH * 2)
    body_html: str = ""


class TemplateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, max_length=MAX_NAME_LENGTH * 2)
    subject: str | None = Field(default=None, max_length=MAX_SUBJECT_LENGTH * 2)
    body_html: str | None = None


def template_out(template: Template) -> TemplateOut:
    return TemplateOut(
        id=template.id,
        name=template.name,
        subject=template.subject,
        body_html=template.body_html,
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


@router.get("", response_model=TemplateListOut)
async def list_templates(auth: Auth, svc: Svc) -> TemplateListOut:
    return TemplateListOut(items=[template_out(t) for t in await svc.templates.list(auth.user_id)])


@router.post("", response_model=TemplateOut, status_code=201)
async def create_template(body: TemplateCreate, auth: Auth, svc: Svc) -> TemplateOut:
    content = TemplateContent(name=body.name, subject=body.subject, body_html=body.body_html)
    return template_out(await svc.templates.create(auth.user_id, content))


@router.patch("/{template_id}", response_model=TemplateOut)
async def update_template(
    template_id: uuid.UUID, body: TemplateUpdate, auth: Auth, svc: Svc
) -> TemplateOut:
    changes = body.model_dump(exclude_none=True)
    return template_out(await svc.templates.update(auth.user_id, template_id, changes))


@router.delete("/{template_id}", status_code=204)
async def delete_template(template_id: uuid.UUID, auth: Auth, svc: Svc) -> Response:
    await svc.templates.delete(auth.user_id, template_id)
    return Response(status_code=204)
