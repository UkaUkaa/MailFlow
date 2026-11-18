from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from datetime import timedelta

import httpx
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.bootstrap import Runtime, Services
from app.core.config import Settings
from app.core.database.engine import tenant_transaction
from app.infrastructure.celery.tasks import build_dispatcher, build_runner
from app.main import create_app
from app.modules.authentication.presentation.dependencies import get_notifier
from app.modules.outbox.application import OutboxDispatcher
from app.modules.synchronization.application import SyncPolicy, SyncRunner
from tests.fakes import (
    CapturingNotifier,
    FakeClock,
    FakeRegistry,
    RecordingOutboxQueue,
    RecordingQueue,
)
from tests.imap_support import GreenMail, ImapTestRegistry

PG = os.environ.get("TEST_PG", "127.0.0.1:54329")
# Override to run against a private database when several checkouts share one Postgres.
PG_DB = os.environ.get("TEST_PG_DB", "mailflow_test")
OWNER_URL = f"postgresql+asyncpg://mailflow_owner:dev_owner_password@{PG}/{PG_DB}"
APP_URL = f"postgresql+asyncpg://mailflow_app:dev_app_password@{PG}/{PG_DB}"
REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://127.0.0.1:63799/15")
PASSWORD = "correct horse battery"


def make_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "environment": "test",
        "app_base_url": "http://test",
        "allowed_hosts": ["test"],
        "database_url": APP_URL,
        "database_migration_url": OWNER_URL,
        "redis_url": REDIS_URL,
        "google_client_id": "client-id",
        "google_client_secret": "client-secret",
        "database_pool_size": 5,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[arg-type]


@pytest.fixture(scope="session", autouse=True)
def _migrate() -> Iterator[None]:
    os.environ["ALEMBIC_DATABASE_URL"] = OWNER_URL
    config = Config("alembic.ini")
    command.upgrade(config, "head")
    yield


@pytest_asyncio.fixture(scope="session")
async def owner_engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(OWNER_URL)
    yield engine
    await engine.dispose()


@pytest.fixture(scope="session")
def settings() -> Settings:
    return make_settings()


@pytest_asyncio.fixture
async def runtime(settings: Settings, owner_engine: AsyncEngine) -> AsyncIterator[Runtime]:
    async with owner_engine.begin() as conn:
        tables = await conn.execute(
            text(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
                "AND tablename <> 'alembic_version'"
            )
        )
        names = ", ".join(row[0] for row in tables)
        await conn.execute(text(f"TRUNCATE {names} CASCADE"))
    rt = Runtime.create(settings, sync_queue=RecordingQueue(), outbox_queue=RecordingOutboxQueue())
    rt.registry = FakeRegistry()
    await rt.redis.flushdb()
    yield rt
    await rt.close()


@pytest.fixture
def registry(runtime: Runtime) -> FakeRegistry:
    assert isinstance(runtime.registry, FakeRegistry)
    return runtime.registry


@pytest.fixture(scope="session")
def greenmail() -> Iterator[GreenMail]:
    """The local IMAP/SMTP test server (docker-compose.dev.yml, service ``greenmail``)."""
    server = GreenMail()
    server.ensure_running()
    yield server
    server.close()


@pytest.fixture
def imap_registry(runtime: Runtime) -> ImapTestRegistry:
    """Real IMAP adapter, allowed to reach the loopback test server and trusting its CA."""
    registry = ImapTestRegistry()
    runtime.registry = registry
    return registry


@pytest.fixture
def queue(runtime: Runtime) -> RecordingQueue:
    assert isinstance(runtime.sync_queue, RecordingQueue)
    return runtime.sync_queue


@pytest.fixture
def notifier() -> CapturingNotifier:
    return CapturingNotifier()


@pytest.fixture
def app(settings: Settings, runtime: Runtime, notifier: CapturingNotifier):  # type: ignore[no-untyped-def]
    application = create_app(settings, runtime)
    application.dependency_overrides[get_notifier] = lambda: notifier
    return application


class ApiClient(httpx.AsyncClient):
    """Test client that performs the CSRF handshake like the real frontend does."""

    async def prepare(self) -> None:
        response = await self.get("/api/v1/auth/csrf")
        self.headers["X-CSRF-Token"] = response.json()["csrf_token"]

    def refresh_csrf(self) -> None:
        token = self.cookies.get("mf_csrf")
        if token:
            self.headers["X-CSRF-Token"] = token


@dataclass
class Actor:
    client: ApiClient
    user_id: uuid.UUID
    email: str


@pytest_asyncio.fixture
async def client_factory(app) -> AsyncIterator[object]:  # type: ignore[no-untyped-def]
    clients: list[ApiClient] = []

    async def factory() -> ApiClient:
        client = ApiClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Origin": "http://test"},
        )
        await client.prepare()
        clients.append(client)
        return client

    yield factory
    for client in clients:
        await client.aclose()


@pytest_asyncio.fixture
async def client(client_factory) -> ApiClient:  # type: ignore[no-untyped-def]
    return await client_factory()  # type: ignore[no-any-return]


@pytest_asyncio.fixture
async def actor_factory(client_factory, notifier: CapturingNotifier):  # type: ignore[no-untyped-def]
    async def factory(email: str) -> Actor:
        client: ApiClient = await client_factory()
        response = await client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": PASSWORD, "display_name": email.split("@")[0]},
        )
        assert response.status_code == 202, response.text
        response = await client.post(
            "/api/v1/auth/verify-email", json={"token": notifier.verifications[email]}
        )
        assert response.status_code == 200, response.text
        response = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
        )
        assert response.status_code == 200, response.text
        client.refresh_csrf()
        return Actor(client, uuid.UUID(response.json()["user"]["id"]), email)

    return factory


@pytest_asyncio.fixture
async def alice(actor_factory) -> Actor:  # type: ignore[no-untyped-def]
    return await actor_factory("alice@example.org")  # type: ignore[no-any-return]


@pytest_asyncio.fixture
async def bob(actor_factory) -> Actor:  # type: ignore[no-untyped-def]
    return await actor_factory("bob@example.org")  # type: ignore[no-any-return]


async def connect_mailbox(
    actor: Actor, registry: FakeRegistry, mailbox_email: str, provider: str = "gmail"
) -> uuid.UUID:
    """Run the full OAuth connect flow through the API with the fake provider."""
    start = await actor.client.post(f"/api/v1/accounts/oauth/{provider}/start", json={})
    assert start.status_code == 200, start.text
    state = start.json()["authorization_url"].split("state=")[1].split("&")[0]
    code = f"code-{uuid.uuid4().hex[:6]}"
    registry.codes[code] = mailbox_email
    callback = await actor.client.get(
        f"/api/v1/accounts/oauth/{provider}/callback", params={"code": code, "state": state}
    )
    assert callback.status_code == 302, callback.text
    location = callback.headers["location"]
    assert "connected=" in location, location
    return uuid.UUID(location.split("connected=")[1])


@pytest.fixture
def sync_policy() -> SyncPolicy:
    return SyncPolicy(
        interval=timedelta(minutes=2),
        page_size=50,
        pages_per_run=5,
        backfill_max_messages=1000,
        lock_ttl_seconds=60,
    )


@pytest.fixture
def runner(runtime: Runtime, sync_policy: SyncPolicy) -> SyncRunner:
    return build_runner(runtime, sync_policy)


@pytest.fixture
def clock(runtime: Runtime) -> FakeClock:
    """Replace the runtime clock (use cases and workers; not session expiry) with a movable one."""
    fake = FakeClock()
    runtime.clock = fake
    return fake


@pytest.fixture
def outbox_queue(runtime: Runtime) -> RecordingOutboxQueue:
    assert isinstance(runtime.outbox_queue, RecordingOutboxQueue)
    return runtime.outbox_queue


@pytest.fixture
def dispatcher(runtime: Runtime, clock: FakeClock) -> OutboxDispatcher:
    return build_dispatcher(runtime)


async def set_undo_send(actor: Actor, seconds: int) -> None:
    response = await actor.client.patch("/api/v1/settings", json={"undo_send_seconds": seconds})
    assert response.status_code == 200, response.text


@pytest.fixture
def services_for(runtime: Runtime):  # type: ignore[no-untyped-def]
    def factory(user_id: uuid.UUID):  # type: ignore[no-untyped-def]
        class _Ctx:
            async def __aenter__(self) -> Services:
                self._cm = tenant_transaction(runtime.session_factory, user_id)
                session = await self._cm.__aenter__()
                return Services(session, runtime)

            async def __aexit__(self, *exc: object) -> None:
                await self._cm.__aexit__(*exc)

        return _Ctx()

    return factory
