"""In-memory provider used by integration tests. No network, deterministic."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta

from app.integrations.email_providers.contracts import (
    Address,
    Credentials,
    FolderRole,
    MessagePage,
    OAuthIdentity,
    OutgoingMessage,
    ProviderAttachment,
    ProviderAuthError,
    ProviderCapabilities,
    ProviderCursorExpired,
    ProviderDraft,
    ProviderFolder,
    ProviderKind,
    ProviderMessage,
    ProviderNotFound,
    ProviderUnavailable,
    SentMessage,
    SyncChanges,
    ThreadAction,
)
from app.integrations.email_providers.gmail.provider import GMAIL_CAPABILITIES
from app.modules.assistant.domain import AiProvider, ReplyDraft, ReplyRequest
from app.modules.assistant.infrastructure.errors import key_rejected

BASE_TIME = datetime(2026, 1, 1, tzinfo=UTC)


def make_message(
    message_id: str,
    *,
    thread_id: str | None = None,
    subject: str = "Hello",
    sender: str = "alice@example.com",
    roles: frozenset[FolderRole] = frozenset({FolderRole.INBOX}),
    is_read: bool = False,
    minutes: int = 0,
    body_html: str | None = "<p>Body</p>",
    attachments: tuple[ProviderAttachment, ...] = (),
    folder_ids: tuple[str, ...] = (),
    is_draft: bool = False,
) -> ProviderMessage:
    return ProviderMessage(
        provider_message_id=message_id,
        provider_thread_id=thread_id or message_id,
        subject=subject,
        snippet=f"snippet {message_id}",
        sender=Address(email=sender, name="Alice"),
        to=(Address(email="me@example.com"),),
        cc=(),
        bcc=(),
        reply_to=(),
        sent_at=BASE_TIME + timedelta(minutes=minutes),
        is_read=is_read,
        is_starred=FolderRole.STARRED in roles,
        is_draft=is_draft,
        roles=roles,
        folder_ids=folder_ids,
        rfc822_message_id=f"<{message_id}@example.com>",
        in_reply_to=None,
        references=None,
        body_html=body_html,
        body_text=None,
        attachments=attachments,
    )


@dataclass
class FakeMailbox:
    email: str
    messages: dict[str, ProviderMessage] = field(default_factory=dict)
    history: list[tuple[str, str]] = field(default_factory=list)  # (kind, message id)
    attachments: dict[tuple[str, str], bytes] = field(default_factory=dict)
    sent: list[OutgoingMessage] = field(default_factory=list)
    drafts: dict[str, str] = field(default_factory=dict)  # draft id -> message id
    actions: list[tuple[str, ThreadAction]] = field(default_factory=list)
    cursor_expired: bool = False
    fail_with: Exception | None = None
    page_size_override: int | None = None
    calls: list[str] = field(default_factory=list)

    def add(self, message: ProviderMessage, *, record: bool = True) -> None:
        self.messages[message.provider_message_id] = message
        if record:
            self.history.append(("upsert", message.provider_message_id))

    def remove(self, message_id: str) -> None:
        self.messages.pop(message_id, None)
        self.history.append(("delete", message_id))


class FakeProvider:
    def __init__(self, mailbox: FakeMailbox) -> None:
        self.mb = mailbox

    @property
    def capabilities(self) -> ProviderCapabilities:
        return GMAIL_CAPABILITIES

    def _check(self, name: str) -> None:
        self.mb.calls.append(name)
        if self.mb.fail_with is not None:
            raise self.mb.fail_with

    async def list_messages(self, *, page_token: str | None, page_size: int) -> MessagePage:
        self._check("list_messages")
        size = self.mb.page_size_override or page_size
        ids = sorted(self.mb.messages, key=lambda i: self.mb.messages[i].sent_at, reverse=True)
        start = int(page_token or 0)
        chunk = ids[start : start + size]
        next_token = str(start + size) if start + size < len(ids) else None
        cursor = str(len(self.mb.history)) if page_token is None else None
        return MessagePage(tuple(chunk), next_token, cursor)

    async def search_messages(
        self, query: str, *, page_token: str | None, page_size: int
    ) -> MessagePage:
        return MessagePage((), None)

    async def get_message(self, provider_message_id: str) -> ProviderMessage:
        self._check("get_message")
        try:
            return self.mb.messages[provider_message_id]
        except KeyError as exc:
            raise ProviderNotFound(provider_message_id) from exc

    async def get_thread(self, provider_thread_id: str) -> list[ProviderMessage]:
        return [m for m in self.mb.messages.values() if m.provider_thread_id == provider_thread_id]

    async def synchronize(self, cursor: str) -> SyncChanges:
        self._check("synchronize")
        if self.mb.cursor_expired:
            self.mb.cursor_expired = False
            raise ProviderCursorExpired("expired")
        records = self.mb.history[int(cursor) :]
        deleted = [i for kind, i in records if kind == "delete"]
        upserted = [i for kind, i in records if kind == "upsert" and i not in deleted]
        return SyncChanges(
            tuple(dict.fromkeys(upserted)), tuple(dict.fromkeys(deleted)), str(len(self.mb.history))
        )

    async def list_folders(self) -> list[ProviderFolder]:
        self._check("list_folders")
        return [
            ProviderFolder("INBOX", "Inbox", FolderRole.INBOX),
            ProviderFolder("SENT", "Sent", FolderRole.SENT),
            ProviderFolder("Label_1", "Projects", FolderRole.CUSTOM),
        ]

    async def _send(self, message: OutgoingMessage, *, draft: bool = False) -> ProviderMessage:
        message_id = f"out-{uuid.uuid4().hex[:8]}"
        stored = ProviderMessage(
            provider_message_id=message_id,
            provider_thread_id=message.provider_thread_id or message_id,
            subject=message.subject,
            snippet=message.body_text[:50],
            sender=message.sender,
            to=message.to,
            cc=message.cc,
            bcc=message.bcc,
            reply_to=(),
            sent_at=BASE_TIME + timedelta(days=1, seconds=len(self.mb.messages)),
            is_read=True,
            is_starred=False,
            is_draft=draft,
            roles=frozenset({FolderRole.DRAFTS if draft else FolderRole.SENT}),
            folder_ids=(),
            rfc822_message_id=f"<{message_id}@example.com>",
            in_reply_to=message.in_reply_to,
            references=message.references,
            body_html=message.body_html,
            body_text=message.body_text,
            attachments=tuple(
                ProviderAttachment(str(i), a.filename, a.mime_type, len(a.content))
                for i, a in enumerate(message.attachments)
            ),
        )
        self.mb.add(stored)
        return stored

    async def send_message(self, message: OutgoingMessage) -> SentMessage:
        self._check("send_message")
        self.mb.sent.append(message)
        stored = await self._send(message)
        return SentMessage(stored.provider_message_id, stored.provider_thread_id)

    reply_message = send_message
    forward_message = send_message

    async def modify_thread(self, provider_thread_id: str, action: ThreadAction) -> None:
        self._check("modify_thread")
        self.mb.actions.append((provider_thread_id, action))

    async def modify_message(self, provider_message_id: str, action: ThreadAction) -> None:
        self._check("modify_message")
        self.mb.actions.append((provider_message_id, action))

    async def delete_message(self, provider_message_id: str) -> None:
        self.mb.remove(provider_message_id)

    async def get_attachment(self, provider_message_id: str, part_id: str) -> bytes:
        self._check("get_attachment")
        try:
            return self.mb.attachments[(provider_message_id, part_id)]
        except KeyError as exc:
            raise ProviderNotFound("attachment") from exc

    async def create_draft(self, message: OutgoingMessage) -> ProviderDraft:
        self._check("create_draft")
        stored = await self._send(message, draft=True)
        draft_id = f"draft-{uuid.uuid4().hex[:8]}"
        self.mb.drafts[draft_id] = stored.provider_message_id
        self.mb.messages[stored.provider_message_id] = replace(stored, provider_draft_id=draft_id)
        return ProviderDraft(draft_id, stored.provider_message_id, stored.provider_thread_id)

    async def update_draft(self, provider_draft_id: str, message: OutgoingMessage) -> ProviderDraft:
        self._check("update_draft")
        old = self.mb.drafts.get(provider_draft_id)
        if old is None:
            raise ProviderNotFound("draft")
        self.mb.remove(old)
        stored = await self._send(message, draft=True)
        self.mb.drafts[provider_draft_id] = stored.provider_message_id
        self.mb.messages[stored.provider_message_id] = replace(
            stored, provider_draft_id=provider_draft_id
        )
        return ProviderDraft(
            provider_draft_id, stored.provider_message_id, stored.provider_thread_id
        )

    async def delete_draft(self, provider_draft_id: str) -> None:
        self._check("delete_draft")
        message_id = self.mb.drafts.pop(provider_draft_id, None)
        if message_id is None:
            raise ProviderNotFound("draft")
        self.mb.remove(message_id)

    async def send_draft(self, provider_draft_id: str) -> SentMessage:
        raise ProviderUnavailable("not used")


class FakeOAuthClient:
    def __init__(self, registry: FakeRegistry) -> None:
        self._r = registry

    def authorization_url(
        self, *, state: str, code_challenge: str, login_hint: str | None = None
    ) -> str:
        self._r.last_challenge = code_challenge
        return f"https://provider.test/auth?state={state}&code_challenge={code_challenge}"

    async def authenticate(self, *, code: str, code_verifier: str) -> Credentials:
        self._r.last_verifier = code_verifier
        if code not in self._r.codes:
            raise ProviderAuthError("bad code")
        email = self._r.codes[code]
        return Credentials(
            access_token=f"at:{email}",
            refresh_token=f"rt:{email}",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            scope="mail",
        )

    async def refresh_credentials(self, credentials: Credentials) -> Credentials:
        self._r.refreshes += 1
        self._r.refresh_tokens_seen.append(credentials.refresh_token or "")
        if self._r.refresh_fails:
            raise ProviderAuthError("invalid_grant")
        refresh_token = credentials.refresh_token
        if self._r.rotate_refresh_tokens:  # Microsoft issues a new refresh token every time
            refresh_token = f"{refresh_token}+"
        return replace(
            credentials,
            refresh_token=refresh_token,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )

    async def revoke_credentials(self, credentials: Credentials) -> None:
        if self._r.revoke_fails:
            raise ProviderUnavailable("down")
        self._r.revoked.append(credentials.refresh_token or "")

    async def fetch_identity(self, credentials: Credentials) -> OAuthIdentity:
        email = credentials.access_token.removeprefix("at:")
        return OAuthIdentity(subject=email, email=email)


class FakeRegistry:
    def __init__(self) -> None:
        self.codes: dict[str, str] = {}
        self.mailboxes: dict[str, FakeMailbox] = {}
        self.revoked: list[str] = []
        self.refreshes = 0
        self.refresh_fails = False
        self.revoke_fails = False
        self.available = True
        self.available_kinds: set[ProviderKind] = {ProviderKind.GMAIL}
        self.rotate_refresh_tokens = False
        self.refresh_tokens_seen: list[str] = []
        self.last_challenge = ""
        self.last_verifier = ""

    def mailbox(self, email: str) -> FakeMailbox:
        return self.mailboxes.setdefault(email, FakeMailbox(email))

    def is_available(self, kind: ProviderKind) -> bool:
        return self.available and kind in self.available_kinds

    def capabilities(self, kind: ProviderKind) -> ProviderCapabilities:
        return GMAIL_CAPABILITIES

    def oauth_client(self, kind: ProviderKind) -> FakeOAuthClient:
        return FakeOAuthClient(self)

    def provider(self, kind: ProviderKind, credentials: Credentials) -> FakeProvider:
        return FakeProvider(self.mailbox(credentials.access_token.removeprefix("at:")))


class RecordingQueue:
    def __init__(self) -> None:
        self.items: list[tuple[uuid.UUID, uuid.UUID]] = []

    def enqueue(self, user_id: uuid.UUID, account_id: uuid.UUID, *, countdown: int = 0) -> None:
        self.items.append((user_id, account_id))


class RecordingOutboxQueue:
    def __init__(self) -> None:
        self.enqueued: list[tuple[uuid.UUID, uuid.UUID, int]] = []

    def enqueue(self, user_id: uuid.UUID, outbox_id: uuid.UUID, *, countdown: int = 0) -> None:
        self.enqueued.append((user_id, outbox_id, countdown))


class FakeClock:
    """A clock tests can move forward; starts at the real time."""

    def __init__(self) -> None:
        self.offset = timedelta(0)

    def now(self) -> datetime:
        return datetime.now(UTC) + self.offset

    def advance(self, **delta: float) -> None:
        self.offset += timedelta(**delta)


class CapturingNotifier:
    def __init__(self) -> None:
        self.verifications: dict[str, str] = {}
        self.resets: dict[str, str] = {}

    async def send_verification(self, *, to: str, token: str, locale: str) -> None:
        self.verifications[to] = token

    async def send_password_reset(self, *, to: str, token: str, locale: str) -> None:
        self.resets[to] = token


@dataclass
class FakeAiGateway:
    """Stands in for OpenAI / Anthropic / Gemini: no network. Records every call."""

    models: dict[AiProvider, list[str]] = field(
        default_factory=lambda: {
            AiProvider.OPENAI: ["gpt-5-mini", "gpt-5", "gpt-4o"],
            AiProvider.ANTHROPIC: ["claude-sonnet-5-5", "claude-opus-5-5"],
            AiProvider.GEMINI: ["gemini-2.5-pro", "gemini-2.5-flash"],
        }
    )
    rejected_keys: set[str] = field(default_factory=set)
    language: str = "uk"
    body: str = "Добрий день!\n\nДякую, підходить.\nДо зустрічі"
    subject: str = ""
    listed: list[tuple[AiProvider, str]] = field(default_factory=list)
    writers: list[tuple[AiProvider, str, str]] = field(default_factory=list)
    requests: list[ReplyRequest] = field(default_factory=list)

    async def list_models(self, provider: AiProvider, api_key: str) -> list[str]:
        self.listed.append((provider, api_key))
        if api_key in self.rejected_keys:
            raise key_rejected()
        return list(self.models[provider])

    def writer(self, provider: AiProvider, api_key: str, model: str) -> _FakeWriter:
        self.writers.append((provider, api_key, model))
        return _FakeWriter(self)


@dataclass
class _FakeWriter:
    gateway: FakeAiGateway

    async def write(self, request: ReplyRequest) -> ReplyDraft:
        self.gateway.requests.append(request)
        return ReplyDraft(
            language=self.gateway.language, body=self.gateway.body, subject=self.gateway.subject
        )
