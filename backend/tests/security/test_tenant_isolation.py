"""Cross-tenant access attempts. Every one must behave exactly like "does not exist"."""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database.base import TENANT_TABLES
from app.core.database.engine import set_tenant, tenant_transaction
from app.integrations.email_providers.contracts import ProviderAttachment
from app.modules.token_vault.domain import CredentialKind, VaultError
from tests.conftest import APP_URL, connect_ai, connect_mailbox
from tests.fakes import make_message


@pytest.fixture
async def world(alice, bob, registry, runner):
    """Alice and Bob each own a mailbox with one conversation and one attachment."""
    data = {}
    for actor, email in ((alice, "alice.box@example.org"), (bob, "bob.box@example.org")):
        account_id = await connect_mailbox(actor, registry, email)
        mailbox = registry.mailbox(email)
        mailbox.add(
            make_message(
                "m1",
                subject=f"Secret of {actor.email}",
                attachments=(ProviderAttachment("1", "secret.txt", "text/plain", 6),),
                folder_ids=("Label_1",),
            ),
            record=False,
        )
        mailbox.attachments[("m1", "1")] = f"{actor.email}".encode()
        assert await runner.run(actor.user_id, account_id) == "ok"
        thread = (await actor.client.get("/api/v1/threads")).json()["items"][0]
        detail = (await actor.client.get(f"/api/v1/threads/{thread['id']}")).json()
        folders = (await actor.client.get("/api/v1/folders")).json()["items"]
        draft = await actor.client.post(
            "/api/v1/emails/drafts",
            json={"account_id": str(account_id), "subject": "private draft"},
        )
        template = await actor.client.post(
            "/api/v1/templates", json={"name": f"Template of {actor.email}"}
        )
        assert template.status_code == 201, template.text
        await connect_ai(actor, "openai", f"sk-key-of-{actor.email}")
        data[actor.email] = {
            "account": str(account_id),
            "thread": thread["id"],
            "message": detail["messages"][0]["id"],
            "attachment": detail["messages"][0]["attachments"][0]["id"],
            "folder": next(f["id"] for f in folders if f["role"] == "custom"),
            "draft": draft.json()["id"],
            "template": template.json()["id"],
            "mailbox": mailbox,
        }
    return data


async def test_lists_only_contain_own_data(alice, bob, world):
    for actor, other in ((alice, bob), (bob, alice)):
        own, foreign = world[actor.email], world[other.email]
        for path in ("/api/v1/accounts", "/api/v1/threads", "/api/v1/folders",
                     "/api/v1/sync/status", "/api/v1/search?q=secret",
                     "/api/v1/threads?view=drafts"):  # fmt: skip
            body = (await actor.client.get(path)).text
            assert other.email not in body, path
            for key in ("account", "thread", "message", "folder", "draft"):
                assert foreign[key] not in body, (path, key)
        assert own["thread"] in (await actor.client.get("/api/v1/threads")).text


async def test_direct_object_references_to_foreign_resources_return_404(alice, bob, world):
    theirs = world[bob.email]
    c = alice.client
    send_payload = {"account_id": theirs["account"], "to": [{"email": "x@example.com"}],
                    "cc": [], "bcc": [], "subject": "s", "body_html": "<p>b</p>", "mode": "new"}  # fmt: skip
    attempts = [
        c.get(f"/api/v1/threads/{theirs['thread']}"),
        c.post(f"/api/v1/threads/{theirs['thread']}/actions", json={"action": "trash"}),
        c.get(f"/api/v1/emails/{theirs['message']}"),
        c.post(f"/api/v1/emails/{theirs['message']}/actions", json={"action": "mark_read"}),
        c.get(f"/api/v1/attachments/{theirs['attachment']}/download"),
        c.get("/api/v1/threads", params={"account_id": theirs["account"]}),
        c.get("/api/v1/threads", params={"folder_id": theirs["folder"]}),
        c.get("/api/v1/folders", params={"account_id": theirs["account"]}),
        c.get("/api/v1/folders/counts", params={"account_id": theirs["account"]}),
        c.get("/api/v1/search", params={"q": "secret", "account_id": theirs["account"]}),
        c.patch(f"/api/v1/accounts/{theirs['account']}", json={"display_name": "pwned"}),
        c.delete(f"/api/v1/accounts/{theirs['account']}"),
        c.post(f"/api/v1/accounts/{theirs['account']}/reconnect", json={}),
        c.post(f"/api/v1/sync/accounts/{theirs['account']}"),
        c.get(f"/api/v1/emails/drafts/{theirs['draft']}"),
        c.put(f"/api/v1/emails/drafts/{theirs['draft']}",
              json={"account_id": theirs["account"], "subject": "x"}),
        c.delete(f"/api/v1/emails/drafts/{theirs['draft']}"),
        c.post("/api/v1/emails/drafts", json={"account_id": theirs["account"], "subject": "x"}),
        c.post("/api/v1/emails/send", data={"payload": json.dumps(send_payload)},
               headers={"Idempotency-Key": uuid.uuid4().hex}),
    ]  # fmt: skip
    for response in await asyncio.gather(*attempts):
        assert response.status_code == 404, (response.request.method, response.request.url)
        assert response.json()["error"]["code"] == "not_found"
    # Nothing of Bob's changed and nothing was sent from his mailbox.
    mailbox = theirs["mailbox"]
    assert mailbox.sent == [] and mailbox.actions == []
    assert (await bob.client.get("/api/v1/accounts")).json()["items"][0]["display_name"] != "pwned"
    assert (await bob.client.get(f"/api/v1/threads/{theirs['thread']}")).status_code == 200


async def test_cannot_mix_own_account_with_foreign_resources(alice, bob, world):
    mine, theirs = world[alice.email], world[bob.email]
    # Reply from my account to a message that lives in someone else's mailbox.
    payload = {"account_id": mine["account"], "to": [{"email": "x@example.com"}], "cc": [],
               "bcc": [], "subject": "Re", "body_html": "<p>b</p>", "mode": "reply",
               "source_message_id": theirs["message"]}  # fmt: skip
    reply = await alice.client.post(
        "/api/v1/emails/send", data={"payload": json.dumps(payload)},
        headers={"Idempotency-Key": uuid.uuid4().hex},
    )  # fmt: skip
    assert reply.status_code == 404
    # Forward someone else's attachment.
    payload = {**payload, "mode": "forward", "source_message_id": mine["message"],
               "forward_attachment_ids": [theirs["attachment"]]}  # fmt: skip
    forward = await alice.client.post(
        "/api/v1/emails/send", data={"payload": json.dumps(payload)},
        headers={"Idempotency-Key": uuid.uuid4().hex},
    )  # fmt: skip
    assert forward.status_code == 404
    assert world[alice.email]["mailbox"].sent == []
    # Bulk action silently skips foreign ids and reports only own ones.
    bulk = await alice.client.post(
        "/api/v1/threads/actions",
        json={"thread_ids": [mine["thread"], theirs["thread"]], "action": "mark_read"},
    )
    assert bulk.json()["updated"] == [mine["thread"]]
    assert theirs["mailbox"].actions == []


async def test_client_supplied_user_id_is_ignored_or_rejected(alice, bob):
    forged = await alice.client.patch(
        "/api/v1/users/me", json={"display_name": "A", "user_id": str(bob.user_id)}
    )
    assert forged.status_code == 422  # unknown fields are rejected outright
    settings = await alice.client.patch(
        "/api/v1/settings", json={"theme": "dark", "user_id": str(bob.user_id)}
    )
    assert settings.status_code == 422
    assert (await bob.client.get("/api/v1/settings")).json()["theme"] == "system"


async def test_settings_and_sessions_are_isolated(alice, bob):
    await alice.client.patch("/api/v1/settings", json={"theme": "dark", "locale": "uk"})
    assert (await bob.client.get("/api/v1/settings")).json()["theme"] == "system"
    bob_session = (await bob.client.get("/api/v1/auth/sessions")).json()["items"][0]["id"]
    assert (await alice.client.delete(f"/api/v1/auth/sessions/{bob_session}")).status_code == 404
    assert (await bob.client.get("/api/v1/auth/me")).status_code == 200
    listed = (await alice.client.get("/api/v1/auth/sessions")).json()["items"]
    assert bob_session not in [s["id"] for s in listed]


async def test_attachment_download_returns_only_own_bytes(alice, bob, world):
    mine = await alice.client.get(
        f"/api/v1/attachments/{world[alice.email]['attachment']}/download"
    )
    assert mine.content == alice.email.encode()


async def test_credentials_are_bound_to_their_account(alice, bob, world, runtime, owner_engine):
    """Copying ciphertext onto another tenant's account must not decrypt (AAD binding)."""
    async with owner_engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE account_credentials AS victim SET ciphertext = src.ciphertext, "
                "nonce = src.nonce, key_id = src.key_id FROM account_credentials AS src "
                "WHERE victim.user_id = :bob AND src.user_id = :alice"
            ),
            {"bob": bob.user_id, "alice": alice.user_id},
        )
    from app.bootstrap import Services

    async with tenant_transaction(runtime.session_factory, bob.user_id) as session:
        with pytest.raises(VaultError):
            await Services(session, runtime).vault.read(
                user_id=bob.user_id,
                account_id=uuid.UUID(world[bob.email]["account"]),
                kind=CredentialKind.OAUTH_TOKENS,
            )


async def test_vault_read_requires_matching_owner(alice, bob, world, runtime):
    from app.bootstrap import Services

    async with tenant_transaction(runtime.session_factory, alice.user_id) as session:
        vault = Services(session, runtime).vault
        foreign = await vault.read(
            user_id=alice.user_id,
            account_id=uuid.UUID(world[bob.email]["account"]),
            kind=CredentialKind.OAUTH_TOKENS,
        )
        own = await vault.read(
            user_id=alice.user_id,
            account_id=uuid.UUID(world[alice.email]["account"]),
            kind=CredentialKind.OAUTH_TOKENS,
        )
    assert foreign is None
    assert own is not None and own[0]["access_token"] == "at:alice.box@example.org"


# -- PostgreSQL row-level security (defense in depth) ------------------------------------------


async def _count(session, table):
    return (await session.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one()


async def test_rls_hides_everything_without_tenant_context(world, runtime):
    async with runtime.session_factory() as session, session.begin():
        for table in TENANT_TABLES:
            assert await _count(session, table) == 0, table


async def test_rls_scopes_rows_even_for_unfiltered_queries(alice, bob, world, runtime):
    for actor in (alice, bob):
        async with tenant_transaction(runtime.session_factory, actor.user_id) as session:
            for table in TENANT_TABLES:
                owners = (
                    (await session.execute(text(f"SELECT DISTINCT user_id FROM {table}")))
                    .scalars()
                    .all()
                )
                assert set(owners) <= {actor.user_id}, table
            assert await _count(session, "email_messages") >= 1


async def test_rls_blocks_cross_tenant_writes(alice, bob, world, runtime):
    theirs = world[bob.email]
    async with tenant_transaction(runtime.session_factory, alice.user_id) as session:
        updated = await session.execute(
            text("UPDATE email_threads SET subject = 'pwned' WHERE id = :id"),
            {"id": theirs["thread"]},
        )
        deleted = await session.execute(
            text("DELETE FROM email_accounts WHERE id = :id"), {"id": theirs["account"]}
        )
        assert updated.rowcount == 0 and deleted.rowcount == 0
    with pytest.raises(DBAPIError):
        async with tenant_transaction(runtime.session_factory, alice.user_id) as session:
            await session.execute(
                text(
                    "INSERT INTO user_settings (user_id, locale, theme, load_remote_images, "
                    "conversation_view) VALUES (:uid, 'en', 'dark', false, true)"
                ),
                {"uid": bob.user_id},
            )
    with pytest.raises(DBAPIError):
        async with tenant_transaction(runtime.session_factory, alice.user_id) as session:
            await session.execute(
                text("UPDATE email_threads SET user_id = :uid"), {"uid": bob.user_id}
            )


async def test_tenant_context_does_not_leak_through_pooled_connections(alice, bob, world):
    """One physical connection, reused: context set in one transaction is gone in the next."""
    engine = create_async_engine(APP_URL, pool_size=1, max_overflow=0)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        pids = []
        async with factory() as session, session.begin():
            await set_tenant(session, alice.user_id)
            pids.append((await session.execute(text("SELECT pg_backend_pid()"))).scalar_one())
            assert await _count(session, "email_accounts") == 1
        async with factory() as session, session.begin():
            pids.append((await session.execute(text("SELECT pg_backend_pid()"))).scalar_one())
            assert await _count(session, "email_accounts") == 0  # no leftover context
            leftover = (
                await session.execute(text("SELECT current_setting('app.current_user_id', true)"))
            ).scalar_one()
            assert leftover in (None, "")
        async with factory() as session, session.begin():
            await set_tenant(session, bob.user_id)
            owners = (
                (await session.execute(text("SELECT user_id FROM email_accounts"))).scalars().all()
            )
            assert owners == [bob.user_id]
        # A rolled-back transaction must not leak either.
        with pytest.raises(RuntimeError):
            async with factory() as session, session.begin():
                await set_tenant(session, alice.user_id)
                raise RuntimeError("boom")
        async with factory() as session, session.begin():
            assert await _count(session, "email_accounts") == 0
        assert len(set(pids)) == 1  # proves the same connection was reused
    finally:
        await engine.dispose()


async def test_concurrent_transactions_keep_their_own_tenant(alice, bob, world, runtime):
    async def observe(user_id):
        seen = set()
        for _ in range(15):
            async with tenant_transaction(runtime.session_factory, user_id) as session:
                rows = await session.execute(text("SELECT user_id FROM email_messages"))
                seen.update(rows.scalars().all())
                await asyncio.sleep(0)
        return seen

    results = await asyncio.gather(*(observe(u) for u in [alice.user_id, bob.user_id] * 6))
    for user_id, seen in zip([alice.user_id, bob.user_id] * 6, results, strict=True):
        assert seen == {user_id}


async def test_concurrent_api_requests_from_two_users_never_cross(alice, bob, world):
    async def fetch(actor):
        return actor, (await actor.client.get("/api/v1/threads")).json()["items"]

    results = await asyncio.gather(*(fetch(a) for a in [alice, bob] * 15))
    for actor, items in results:
        assert [t["subject"] for t in items if "Secret" in t["subject"]] == [
            f"Secret of {actor.email}"
        ]


async def test_application_role_cannot_bypass_rls(runtime):
    async with runtime.session_factory() as session, session.begin():
        row = (
            await session.execute(
                text(
                    "SELECT rolsuper, rolbypassrls, "
                    "(SELECT count(*) FROM pg_tables WHERE tableowner = current_user) AS owned "
                    "FROM pg_roles WHERE rolname = current_user"
                )
            )
        ).one()
    assert row.rolsuper is False and row.rolbypassrls is False and row.owned == 0


async def test_every_tenant_table_has_rls_enabled(owner_engine):
    async with owner_engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT c.relname, c.relrowsecurity FROM pg_class c "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'public' AND c.relkind = 'r'"
                )
            )
        ).all()
        columns = (
            (
                await conn.execute(
                    text(
                        "SELECT table_name FROM information_schema.columns "
                        "WHERE table_schema = 'public' AND column_name = 'user_id'"
                    )
                )
            )
            .scalars()
            .all()
        )
    enabled = {name for name, rls in rows if rls}
    assert enabled == set(TENANT_TABLES)
    # Any table that carries user_id must either be tenant-protected or a known auth table.
    auth_tables = {"user_sessions", "email_verification_tokens", "password_reset_tokens",
                   "audit_events", "user_identities"}  # fmt: skip
    assert set(columns) - enabled == auth_tables


async def test_vault_key_rotation_reencrypts_only_the_users_credentials(
    alice, bob, world, runtime, owner_engine
):
    import os

    from app.core.database.engine import tenant_transaction as tx
    from app.modules.token_vault.application import TokenVault
    from app.modules.token_vault.infrastructure import AesGcmKeyring, SqlCredentialRepository

    old_ring = runtime.cipher
    old_key_id = old_ring.primary_key_id
    rotated = AesGcmKeyring(
        {old_key_id: _raw_key(old_ring, old_key_id), "k-new": os.urandom(32)},
        "k-new",
    )
    async with tx(runtime.session_factory, alice.user_id) as session:
        vault = TokenVault(rotated, SqlCredentialRepository(session))
        assert await vault.rotate_user(alice.user_id) == 1
        assert await vault.rotate_user(alice.user_id) == 0  # idempotent
        secret, _ = await vault.read(
            user_id=alice.user_id,
            account_id=uuid.UUID(world[alice.email]["account"]),
            kind=CredentialKind.OAUTH_TOKENS,
        )
    assert secret["refresh_token"] == "rt:alice.box@example.org"
    async with owner_engine.connect() as conn:
        rows = dict(
            (await conn.execute(text("SELECT user_id, key_id FROM account_credentials"))).all()
        )
    assert rows[alice.user_id] == "k-new" and rows[bob.user_id] == old_key_id


def _raw_key(ring, key_id: str) -> bytes:
    """Test helper: rebuild the development key the runtime derives when none is configured."""
    import hashlib

    assert key_id == "dev"
    return hashlib.sha256(b"mailflow-insecure-development-key").digest()


async def test_account_avatar_is_isolated(alice, bob, world):
    theirs = world[bob.email]["account"]
    url = f"/api/v1/accounts/{theirs}/avatar"
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    assert (
        await bob.client.put(url, files={"file": ("a.png", png, "image/png")})
    ).status_code == 200
    assert (await alice.client.get(url)).status_code == 404
    response = await alice.client.put(url, files={"file": ("a.png", png, "image/png")})
    assert response.status_code == 404
    assert (await alice.client.delete(url)).status_code == 404
    assert (await bob.client.get(url)).content == png


async def test_user_secrets_are_bound_to_their_owner(alice, bob, world, runtime, owner_engine):
    """A user's AI key cannot be read as someone else's, even if the row is moved."""
    from app.core.database.engine import tenant_transaction as tx
    from app.modules.token_vault.application import UserSecretVault
    from app.modules.token_vault.domain import UserSecretKind, VaultError
    from app.modules.token_vault.infrastructure import SqlUserSecretRepository

    kind = UserSecretKind.AI_API_KEY
    async with tx(runtime.session_factory, alice.user_id) as session:
        vault = UserSecretVault(runtime.cipher, SqlUserSecretRepository(session))
        assert await vault.read(user_id=alice.user_id, kind=kind) == f"sk-key-of-{alice.email}"
        # RLS: Alice's session cannot see Bob's row at all.
        assert await vault.read(user_id=bob.user_id, kind=kind) is None

    async with owner_engine.begin() as conn:
        await conn.execute(text("DELETE FROM user_secrets WHERE user_id = :b"), {"b": bob.user_id})
        await conn.execute(
            text("UPDATE user_secrets SET user_id = :b WHERE user_id = :a"),
            {"a": alice.user_id, "b": bob.user_id},
        )
    async with tx(runtime.session_factory, bob.user_id) as session:
        vault = UserSecretVault(runtime.cipher, SqlUserSecretRepository(session))
        with pytest.raises(VaultError):
            await vault.read(user_id=bob.user_id, kind=kind)
