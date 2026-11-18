from __future__ import annotations

import uuid

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from app.api.deps import Auth, Svc
from app.modules.assistant.domain import (
    MAX_API_KEY_LENGTH,
    MAX_INSTRUCTION_LENGTH,
    MAX_SUBJECT_LENGTH,
    AiProvider,
    AssistantConfig,
)

router = APIRouter(prefix="/assistant", tags=["assistant"])


class AssistantOut(BaseModel):
    """The user's AI connection. Never contains the key, only its last four characters."""

    configured: bool
    provider: AiProvider | None = None
    model: str | None = None
    key_hint: str | None = None
    models: list[str] = []


class ConnectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: AiProvider
    api_key: SecretStr = Field(max_length=MAX_API_KEY_LENGTH + 64)
    model: str | None = Field(default=None, max_length=128)


class ModelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str = Field(max_length=128)


class ReplyDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_message_id: uuid.UUID
    instruction: str = Field(default="", max_length=MAX_INSTRUCTION_LENGTH * 2)


class ReplyDraftOut(BaseModel):
    language: str
    body_html: str


class MessageDraftRequest(BaseModel):
    """A new email or a forward's note. The account must be the caller's own (else 404)."""

    model_config = ConfigDict(extra="forbid")
    account_id: uuid.UUID
    instruction: str = Field(default="", max_length=MAX_INSTRUCTION_LENGTH * 2)
    subject: str = Field(default="", max_length=MAX_SUBJECT_LENGTH)
    recipient_email: str | None = Field(default=None, max_length=320)
    recipient_name: str | None = Field(default=None, max_length=256)
    forwarded_message_id: uuid.UUID | None = None


class MessageDraftOut(ReplyDraftOut):
    #: Suggested only when the request had no subject; empty otherwise.
    subject: str


def assistant_out(config: AssistantConfig | None) -> AssistantOut:
    if config is None:
        return AssistantOut(configured=False)
    return AssistantOut(
        configured=True,
        provider=config.provider,
        model=config.model,
        key_hint=config.key_hint,
        models=list(config.models),
    )


@router.get("", response_model=AssistantOut)
async def get_assistant(auth: Auth, svc: Svc) -> AssistantOut:
    return assistant_out(await svc.assistant.get_config(auth.user_id))


@router.put("", response_model=AssistantOut)
async def connect_assistant(body: ConnectRequest, auth: Auth, svc: Svc) -> AssistantOut:
    """Checks the key with the provider (and lists its models) before storing it."""
    config = await svc.assistant.connect(
        auth.user_id, body.provider, body.api_key.get_secret_value(), body.model
    )
    return assistant_out(config)


@router.patch("", response_model=AssistantOut)
async def choose_model(body: ModelRequest, auth: Auth, svc: Svc) -> AssistantOut:
    return assistant_out(await svc.assistant.set_model(auth.user_id, body.model))


@router.delete("", status_code=204)
async def disconnect_assistant(auth: Auth, svc: Svc) -> Response:
    await svc.assistant.disconnect(auth.user_id)
    return Response(status_code=204)


@router.post("/reply", response_model=ReplyDraftOut)
async def draft_reply(body: ReplyDraftRequest, auth: Auth, svc: Svc) -> ReplyDraftOut:
    draft = await svc.assistant.draft_reply(auth.user_id, body.source_message_id, body.instruction)
    return ReplyDraftOut(language=draft.language, body_html=draft.body_html)


@router.post("/compose", response_model=MessageDraftOut)
async def draft_message(body: MessageDraftRequest, auth: Auth, svc: Svc) -> MessageDraftOut:
    draft = await svc.assistant.draft_message(
        auth.user_id,
        body.account_id,
        body.instruction,
        body.subject,
        body.recipient_email,
        body.recipient_name,
        body.forwarded_message_id,
    )
    return MessageDraftOut(
        language=draft.language, subject=draft.subject, body_html=draft.body_html
    )
