from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Protocol

from app.modules.assistant.domain import (
    MAX_INSTRUCTION_LENGTH,
    MAX_SAMPLE_CHARS,
    MAX_STYLE_SAMPLES,
    MAX_THREAD_CHARS,
    AiProvider,
    AssistantConfig,
    DraftKind,
    ReplyDraft,
    ReplyRequest,
    ThreadEntry,
    clean_subject,
    clip,
    default_model,
    draft_to_html,
    fit_thread,
    is_plausible_api_key,
    key_hint,
    normalize_language,
    strip_quoted,
)
from app.modules.email_accounts.application.services import AccountService
from app.modules.emails.application.queries import ThreadQueryService
from app.modules.emails.domain.entities import Message
from app.modules.token_vault.application import UserSecretVault
from app.modules.token_vault.domain import UserSecretKind
from app.modules.users.application import UserProfileService
from app.shared.application.ports import RateLimiter
from app.shared.domain.errors import ConflictError, FieldProblem, InvalidInputError

KEY = UserSecretKind.AI_API_KEY


class ReplyWriter(Protocol):
    """Turns a reply request into a draft. Raises domain errors (key rejected, refused ...)."""

    async def write(self, request: ReplyRequest) -> ReplyDraft: ...


class AiGateway(Protocol):
    """Talks to the AI provider the user picked, with the user's own key."""

    async def list_models(self, provider: AiProvider, api_key: str) -> list[str]:
        """Models this key can use for drafting, preferred first. Proves the key works."""

    def writer(self, provider: AiProvider, api_key: str, model: str) -> ReplyWriter: ...


class AssistantConfigRepository(Protocol):
    async def get(self, user_id: uuid.UUID) -> AssistantConfig | None: ...
    async def save(self, user_id: uuid.UUID, config: AssistantConfig) -> None: ...
    async def delete(self, user_id: uuid.UUID) -> None: ...


@dataclass(frozen=True, slots=True)
class DraftedReply:
    language: str
    body_html: str
    #: Suggested for a new email with no subject yet; empty otherwise.
    subject: str = ""


def _text(message: Message) -> str:
    return strip_quoted(message.body_text or message.snippet or "")


def _not_configured() -> ConflictError:
    return ConflictError("Add your AI key in settings first.", code="assistant_not_configured")


class AssistantService:
    def __init__(
        self,
        gateway: AiGateway,
        configs: AssistantConfigRepository,
        secrets: UserSecretVault,
        threads: ThreadQueryService,
        accounts: AccountService,
        profile: UserProfileService,
        limiter: RateLimiter,
        requests_per_hour: int,
    ) -> None:
        self._gateway = gateway
        self._configs = configs
        self._secrets = secrets
        self._threads = threads
        self._accounts = accounts
        self._profile = profile
        self._limiter = limiter
        self._per_hour = requests_per_hour

    # -- the user's AI connection ----------------------------------------------------------

    async def get_config(self, user_id: uuid.UUID) -> AssistantConfig | None:
        return await self._configs.get(user_id)

    async def connect(
        self, user_id: uuid.UUID, provider: AiProvider, api_key: str, model: str | None
    ) -> AssistantConfig:
        key = api_key.strip()
        if not is_plausible_api_key(key):
            raise InvalidInputError(problems=[FieldProblem("api_key", "invalid")])
        # Each attempt calls the provider: keep MailFlow from becoming a key-testing service.
        await self._limiter.hit(f"assistant-key:{user_id}", limit=10, window_seconds=3600)
        models = tuple(await self._gateway.list_models(provider, key))
        if not models:
            raise InvalidInputError(
                "This key cannot use any model that writes text.", code="assistant_no_models"
            )
        chosen = model if model in models else default_model(provider, models)
        config = AssistantConfig(
            provider=provider, model=chosen, key_hint=key_hint(key), models=models
        )
        await self._secrets.store(user_id=user_id, kind=KEY, secret=key)
        await self._configs.save(user_id, config)
        return config

    async def set_model(self, user_id: uuid.UUID, model: str) -> AssistantConfig:
        config = await self._configs.get(user_id)
        if config is None:
            raise _not_configured()
        if model not in config.models:
            raise InvalidInputError(problems=[FieldProblem("model", "unsupported")])
        updated = AssistantConfig(config.provider, model, config.key_hint, config.models)
        await self._configs.save(user_id, updated)
        return updated

    async def disconnect(self, user_id: uuid.UUID) -> None:
        await self._secrets.delete(user_id=user_id, kind=KEY)
        await self._configs.delete(user_id)

    # -- drafting --------------------------------------------------------------------------

    async def _connection(self, user_id: uuid.UUID) -> tuple[AssistantConfig, str]:
        config = await self._configs.get(user_id)
        api_key = await self._secrets.read(user_id=user_id, kind=KEY) if config else None
        if config is None or api_key is None:
            raise _not_configured()
        return config, api_key

    @staticmethod
    def _note(instruction: str) -> str:
        note = instruction.strip()
        if len(note) > MAX_INSTRUCTION_LENGTH:
            raise InvalidInputError(problems=[FieldProblem("instruction", "too_long")])
        return note

    async def _style(
        self,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        correspondent: str | None,
        exclude: set[uuid.UUID],
    ) -> tuple[str, ...]:
        samples = await self._threads.sent_samples(
            user_id, account_id, correspondent, MAX_STYLE_SAMPLES
        )
        return tuple(
            clip(text, MAX_SAMPLE_CHARS)
            for text in (_text(m) for m in samples if m.id not in exclude)
            if text
        )

    async def _write(
        self, config: AssistantConfig, api_key: str, request: ReplyRequest
    ) -> DraftedReply:
        draft = await self._gateway.writer(config.provider, api_key, config.model).write(request)
        return DraftedReply(
            language=normalize_language(draft.language),
            body_html=draft_to_html(draft.body),
            subject=clean_subject(draft.subject) if request.kind is DraftKind.NEW else "",
        )

    async def draft_reply(
        self, user_id: uuid.UUID, source_message_id: uuid.UUID, instruction: str
    ) -> DraftedReply:
        config, api_key = await self._connection(user_id)
        note = self._note(instruction)

        # Ownership: both lookups filter on the caller; someone else's message is a 404.
        source = (await self._threads.get_message(user_id, source_message_id)).message
        detail = await self._threads.get_detail(user_id, source.thread_id)
        account = await self._accounts.get(user_id, source.account_id)
        me = account.email_address.lower()
        user = await self._profile.get(user_id)

        await self._limiter.hit(f"assistant:{user_id}", limit=self._per_hour, window_seconds=3600)

        def mine(message: Message) -> bool:
            return message.flags.in_sent or (
                message.sender is not None and message.sender.email.lower() == me
            )

        history = [m.message for m in detail.messages if not m.message.flags.is_draft]
        history = [m for m in history if m.sent_at <= source.sent_at] or [source]
        correspondent = next(
            (m.sender for m in reversed(history) if m.sender and not mine(m)),
            source.to[0] if source.to else source.sender,
        )
        entries = [
            ThreadEntry(
                author_name=(m.sender.name or "") if m.sender else "",
                author_email=m.sender.email if m.sender else "",
                is_mine=mine(m),
                sent_at=m.sent_at,
                text=_text(m),
            )
            for m in history
        ]
        thread, omitted = fit_thread(entries, MAX_THREAD_CHARS)
        style = await self._style(
            user_id,
            source.account_id,
            correspondent.email if correspondent else None,
            {m.id for m in history},
        )

        return await self._write(
            config,
            api_key,
            ReplyRequest(
                instruction=note,
                subject=detail.summary.subject,
                my_name=user.display_name or account.display_name or "",
                my_email=account.email_address,
                correspondent_name=(correspondent.name or "") if correspondent else "",
                correspondent_email=correspondent.email if correspondent else "",
                thread=thread,
                omitted_messages=omitted,
                style_samples=style,
            ),
        )

    async def draft_message(
        self,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        instruction: str,
        subject: str,
        recipient_email: str | None,
        recipient_name: str | None,
        forwarded_message_id: uuid.UUID | None = None,
    ) -> DraftedReply:
        """A new email (or a forward's cover note) sent from ``account_id``.

        The mailbox is the user's own (someone else's is a 404); the forwarded message, when
        given, is read through the same user-scoped query and is the only mail context.
        """
        config, api_key = await self._connection(user_id)
        note = self._note(instruction)
        account = await self._accounts.get(user_id, account_id)
        forwarded = (
            (await self._threads.get_message(user_id, forwarded_message_id)).message
            if forwarded_message_id
            else None
        )
        user = await self._profile.get(user_id)

        await self._limiter.hit(f"assistant:{user_id}", limit=self._per_hour, window_seconds=3600)

        thread: tuple[ThreadEntry, ...] = ()
        if forwarded is not None:
            thread, _ = fit_thread(
                [
                    ThreadEntry(
                        author_name=(forwarded.sender.name or "") if forwarded.sender else "",
                        author_email=forwarded.sender.email if forwarded.sender else "",
                        is_mine=False,
                        sent_at=forwarded.sent_at,
                        text=_text(forwarded),
                    )
                ],
                MAX_THREAD_CHARS,
            )
        correspondent = (recipient_email or "").strip() or None
        style = await self._style(
            user_id, account.id, correspondent, {forwarded.id} if forwarded else set()
        )
        return await self._write(
            config,
            api_key,
            ReplyRequest(
                instruction=note,
                subject=subject.strip(),
                my_name=user.display_name or account.display_name or "",
                my_email=account.email_address,
                correspondent_name=(recipient_name or "").strip() if correspondent else "",
                correspondent_email=correspondent or "",
                thread=thread,
                omitted_messages=0,
                style_samples=style,
                kind=DraftKind.FORWARD if forwarded else DraftKind.NEW,
            ),
        )
