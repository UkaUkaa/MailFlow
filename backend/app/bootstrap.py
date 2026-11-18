"""Composition root shared by the API process and the Celery workers.

This is the one place (besides ``authentication.presentation.dependencies``) allowed to import
every module's infrastructure. It wires implementations to the ports declared by the
application layers; nothing here contains business rules.
"""

from __future__ import annotations

import base64
import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from functools import cached_property
from typing import Protocol

import httpx
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.database.engine import create_engine, create_session_factory
from app.core.logging import get_logger
from app.core.security.passwords import Argon2PasswordHasher
from app.infrastructure.redis import (
    RedisIdempotencyStore,
    RedisLock,
    RedisRateLimiter,
    RedisTenantCache,
    create_redis,
)
from app.integrations.email_providers.contracts import ProviderRegistry
from app.integrations.email_providers.registry import (
    DefaultProviderRegistry,
    build_provider_http_client,
)
from app.modules.attachments.application import AttachmentService
from app.modules.attachments.infrastructure import SafeAttachmentNormalizer, SqlAttachmentRepository
from app.modules.audit.infrastructure import SqlAuditLog
from app.modules.authentication.infrastructure.repositories import SqlSessionRepository
from app.modules.email_accounts.application.services import AccountService, ConnectAccountService
from app.modules.email_accounts.application.sessions import ProviderSessionFactory
from app.modules.email_accounts.infrastructure.repositories import (
    IndependentAccountStatusMarker,
    SqlAccountRepository,
    SqlOAuthStateRepository,
)
from app.modules.emails.application.actions import ThreadActionService
from app.modules.emails.application.compose import ComposeLimits, ComposeService
from app.modules.emails.application.ingestion import MessageIngestor
from app.modules.emails.application.queries import ThreadQueryService
from app.modules.emails.infrastructure.repositories import SqlMailRepository
from app.modules.emails.infrastructure.sanitizer import Nh3HtmlSanitizer
from app.modules.folders.application import FolderService
from app.modules.folders.infrastructure import SqlFolderRepository
from app.modules.outbox.application import OutboxQueue, OutboxService
from app.modules.outbox.infrastructure import SqlOutboxRepository
from app.modules.settings.application import SettingsService
from app.modules.settings.infrastructure import SqlSettingsRepository
from app.modules.synchronization.application import SyncQueue, SyncRequestService
from app.modules.synchronization.infrastructure import SqlSyncStateRepository
from app.modules.token_vault.application import Cipher, TokenVault
from app.modules.token_vault.infrastructure import AesGcmKeyring, SqlCredentialRepository
from app.modules.users.application import AccountLifecycleService, UserProfileService
from app.modules.users.infrastructure import SqlUserRepository
from app.shared.application.ports import Clock, SystemClock

logger = get_logger(__name__)
_hasher = Argon2PasswordHasher()


def build_cipher(settings: Settings) -> Cipher:
    raw = settings.vault_keys.get_secret_value()
    if raw:
        return AesGcmKeyring.from_config(raw, settings.vault_primary_key_id)
    # Settings validation guarantees this branch is unreachable in production.
    logger.warning("vault_using_insecure_development_key")
    key = hashlib.sha256(b"mailflow-insecure-development-key").digest()
    return AesGcmKeyring.from_config(f"dev:{base64.b64encode(key).decode()}", "dev")


class _NullQueue:
    def enqueue(self, user_id: uuid.UUID, account_id: uuid.UUID, *, countdown: int = 0) -> None:
        return None


class _NullOutboxQueue:
    """No direct hand-off: due items are found by the beat scan alone."""

    def enqueue(self, user_id: uuid.UUID, outbox_id: uuid.UUID, *, countdown: int = 0) -> None:
        return None


@dataclass
class Runtime:
    """Process-wide singletons."""

    settings: Settings
    engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]
    redis: Redis
    http: httpx.AsyncClient
    registry: ProviderRegistry
    cipher: Cipher
    sync_queue: SyncQueue
    clock: Clock
    outbox_queue: OutboxQueue = field(default_factory=_NullOutboxQueue)

    @classmethod
    def create(
        cls,
        settings: Settings,
        *,
        pooled: bool = True,
        sync_queue: SyncQueue | None = None,
        outbox_queue: OutboxQueue | None = None,
    ) -> Runtime:
        engine = create_engine(settings, pooled=pooled)
        http = build_provider_http_client(settings)
        return cls(
            settings=settings,
            engine=engine,
            session_factory=create_session_factory(engine),
            redis=create_redis(settings.redis_url),
            http=http,
            registry=DefaultProviderRegistry(settings, http, background=not pooled),
            cipher=build_cipher(settings),
            sync_queue=sync_queue or _NullQueue(),
            clock=SystemClock(),
            outbox_queue=outbox_queue or _NullOutboxQueue(),
        )

    async def close(self) -> None:
        await self.http.aclose()
        await self.redis.aclose()
        await self.engine.dispose()


class _SessionRevoker(Protocol):
    async def revoke_all(self, user_id: uuid.UUID) -> None: ...


class _SqlSessionRevoker:
    def __init__(self, sessions: SqlSessionRepository, clock: Clock) -> None:
        self._sessions = sessions
        self._clock = clock

    async def revoke_all(self, user_id: uuid.UUID) -> None:
        await self._sessions.revoke_all(user_id, self._clock.now())


class Services:
    """Use cases bound to one database session (one transaction). Built lazily."""

    def __init__(self, session: AsyncSession, runtime: Runtime) -> None:
        self._db = session
        self._rt = runtime

    @cached_property
    def audit(self) -> SqlAuditLog:
        return SqlAuditLog(self._rt.session_factory)

    @cached_property
    def limiter(self) -> RedisRateLimiter:
        return RedisRateLimiter(self._rt.redis)

    @cached_property
    def lock(self) -> RedisLock:
        return RedisLock(self._rt.redis)

    @cached_property
    def users(self) -> SqlUserRepository:
        return SqlUserRepository(self._db)

    @cached_property
    def vault(self) -> TokenVault:
        return TokenVault(self._rt.cipher, SqlCredentialRepository(self._db))

    @cached_property
    def account_repository(self) -> SqlAccountRepository:
        return SqlAccountRepository(self._db)

    @cached_property
    def provider_sessions(self) -> ProviderSessionFactory:
        return ProviderSessionFactory(
            self.account_repository,
            self.vault,
            self._rt.registry,
            self.lock,
            IndependentAccountStatusMarker(self._rt.session_factory),
            self._rt.clock,
        )

    @cached_property
    def folders(self) -> FolderService:
        return FolderService(SqlFolderRepository(self._db))

    @cached_property
    def attachments(self) -> AttachmentService:
        return AttachmentService(
            SqlAttachmentRepository(self._db),
            self.provider_sessions,
            SafeAttachmentNormalizer(),
            self._rt.settings.max_message_attachment_bytes,
        )

    @cached_property
    def mail(self) -> SqlMailRepository:
        return SqlMailRepository(self._db)

    @cached_property
    def ingestor(self) -> MessageIngestor:
        return MessageIngestor(self.mail, self.attachments, Nh3HtmlSanitizer())

    @cached_property
    def thread_queries(self) -> ThreadQueryService:
        return ThreadQueryService(self.mail, self.folders, self.attachments)

    @cached_property
    def thread_actions(self) -> ThreadActionService:
        return ThreadActionService(self.mail, self.provider_sessions, self.ingestor)

    @cached_property
    def compose(self) -> ComposeService:
        settings = self._rt.settings
        return ComposeService(
            self.mail,
            self.provider_sessions,
            self.ingestor,
            self.attachments,
            Nh3HtmlSanitizer(),
            SafeAttachmentNormalizer(),
            RedisIdempotencyStore(self._rt.redis),
            self.limiter,
            self.audit,
            ComposeLimits(settings.max_message_attachment_bytes, settings.max_message_attachments),
        )

    @cached_property
    def sync_states(self) -> SqlSyncStateRepository:
        return SqlSyncStateRepository(self._db)

    @cached_property
    def sync_requests(self) -> SyncRequestService:
        return SyncRequestService(
            self.sync_states,
            self.provider_sessions,
            self._rt.sync_queue,
            self.limiter,
            self._rt.clock,
        )

    @cached_property
    def accounts(self) -> AccountService:
        return AccountService(
            self.account_repository, self.vault, self._rt.registry, self.audit, self._rt.clock
        )

    @cached_property
    def connect_accounts(self) -> ConnectAccountService:
        return ConnectAccountService(
            self.account_repository,
            SqlOAuthStateRepository(self._db),
            self.vault,
            self._rt.cipher,
            self._rt.registry,
            self.sync_requests,
            self.limiter,
            self.audit,
            self._rt.clock,
            timedelta(minutes=self._rt.settings.oauth_state_ttl_minutes),
        )

    @cached_property
    def profile(self) -> UserProfileService:
        return UserProfileService(self.users)

    @cached_property
    def lifecycle(self) -> AccountLifecycleService:
        return AccountLifecycleService(
            self.users,
            _hasher,
            _SqlSessionRevoker(SqlSessionRepository(self._db), self._rt.clock),
            self.accounts,
            RedisTenantCache(self._rt.redis),
            self.audit,
        )

    @cached_property
    def settings(self) -> SettingsService:
        return SettingsService(SqlSettingsRepository(self._db))

    @cached_property
    def outbox_repository(self) -> SqlOutboxRepository:
        return SqlOutboxRepository(self._db)

    @cached_property
    def outbox(self) -> OutboxService:
        return OutboxService(
            self.outbox_repository,
            self.compose,
            self.settings,
            self._rt.outbox_queue,
            self.audit,
            self._rt.clock,
        )

    @property
    def registry(self) -> ProviderRegistry:
        return self._rt.registry
