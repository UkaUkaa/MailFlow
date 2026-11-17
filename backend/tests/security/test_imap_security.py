"""Security properties of the password-based (IMAP/SMTP) provider."""

from __future__ import annotations

import socket
import uuid

import pytest
from sqlalchemy import text

from app.integrations.email_providers.imap import MailConnector
from app.modules.email_accounts.application.sessions import secret_to_server_credentials
from app.modules.token_vault.domain import CredentialKind, VaultError
from tests.conftest import make_settings
from tests.imap_support import HOST, IMAP_PORT, IMAPS_PORT, SMTPS_PORT, ImapTestRegistry, mail

PATH = "/api/v1/accounts/imap"


def body(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "email_address": "someone@example.org",
        "imap": {"host": "imap.example.org", "port": 993, "security": "ssl"},
        "smtp": {"host": "smtp.example.org", "port": 587, "security": "starttls"},
        "username": "someone@example.org",
        "password": "correct-horse-battery-staple",
    }
    payload.update(overrides)
    return payload


def server(host: str, port: int, security: str = "ssl") -> dict[str, object]:
    return {"host": host, "port": port, "security": security}


@pytest.fixture
def guarded_registry(runtime):
    """The real adapter with the production guard: public addresses and mail ports only."""
    registry = ImapTestRegistry(MailConnector(connect_timeout=3, io_timeout=3))
    runtime.registry = registry
    return registry


# -- the test-only switches ----------------------------------------------------------------------


@pytest.mark.parametrize("environment", ["development", "production"])
@pytest.mark.parametrize(
    "switch", [{"ssrf_allow_private_networks": True}, {"mail_tls_ca_file": "/tmp/ca.pem"}]
)
def test_escape_hatches_are_rejected_outside_the_test_environment(environment, switch):
    production = {
        "app_base_url": "https://mail.example.com",
        "vault_keys": "k1:" + "A" * 43 + "=",
        "database_url": "postgresql+asyncpg://app:secret@db/mailflow",
    }
    extra = production if environment == "production" else {}
    make_settings(environment=environment, **extra)  # valid without the switch
    with pytest.raises(ValueError, match="only allowed when ENVIRONMENT=test"):
        make_settings(environment=environment, **extra, **switch)


def test_escape_hatches_default_to_off_and_work_only_in_test():
    settings = make_settings()
    assert settings.ssrf_allow_private_networks is False and settings.mail_tls_ca_file is None
    assert make_settings(ssrf_allow_private_networks=True).ssrf_allow_private_networks is True


# -- SSRF through the API ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "imap,smtp,field",
    [
        (server("127.0.0.1", 993), None, "imap"),
        (server("localhost", 993), None, "imap"),
        (server("10.0.0.8", 993), None, "imap"),
        (server("192.168.1.1", 143, "starttls"), None, "imap"),
        (server("169.254.169.254", 993), None, "imap"),
        (server("[::1]", 993), None, "imap"),
        (server("::ffff:10.0.0.1", 993), None, "imap"),
        (server("0.0.0.0", 993), None, "imap"),
        (server("imap.example.org", 22), None, "imap"),
        (server("imap.example.org", 6379), None, "imap"),
        (server("imap.example.org", 587), None, "imap"),  # an SMTP port is not an IMAP port
        (None, server("127.0.0.1", 587, "starttls"), "smtp"),
        (None, server("smtp.example.org", 25, "starttls"), "smtp"),
        (None, server("smtp.example.org", 993), "smtp"),
    ],
)
async def test_internal_addresses_and_other_ports_are_blocked(
    alice, guarded_registry, queue, monkeypatch, imap, smtp, field
):
    connections: list[object] = []
    monkeypatch.setattr(socket, "create_connection", lambda *a, **k: connections.append(a))
    # Public-looking names resolve to a public address here; nothing may be dialled anyway.
    guarded_registry.connector = MailConnector(resolver=_public_resolver)
    payload = body(**({"imap": imap} if imap else {}), **({"smtp": smtp} if smtp else {}))
    response = await alice.client.post(PATH, json=payload)
    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "blocked_destination"
    assert error["details"] == [{"field": field, "code": "blocked_destination"}]
    assert connections == [] and queue.items == []
    assert (await alice.client.get("/api/v1/accounts")).json()["items"] == []


async def _public_resolver(host: str, port: int) -> list[str]:
    return ["127.0.0.1"] if host == "localhost" else ["93.184.216.34"]


async def test_host_that_resolves_to_a_private_address_is_blocked(alice, guarded_registry):
    async def internal(host: str, port: int) -> list[str]:
        return ["93.184.216.34", "10.1.2.3"]

    guarded_registry.connector = MailConnector(resolver=internal)
    response = await alice.client.post(PATH, json=body())
    assert response.json()["error"]["code"] == "blocked_destination"


# -- uniform errors ------------------------------------------------------------------------------


async def test_error_codes_do_not_describe_the_remote_port(alice, greenmail, imap_registry):
    """Closed port, a port speaking another protocol, a plaintext service and an untrusted
    certificate are indistinguishable; only "login rejected" and "no TLS offered" differ."""
    box = greenmail.user(folders=False)
    closed = socket.create_server(("127.0.0.1", 0))
    closed_port = closed.getsockname()[1]
    closed.close()
    good_imap = server(HOST, IMAPS_PORT)
    variants = {
        "closed port": {"imap": server("127.0.0.1", closed_port)},
        "plaintext service on a TLS port": {"imap": server(HOST, IMAP_PORT)},
        "http service": {"imap": server("127.0.0.1", 18081)},
        "smtp closed port": {"imap": good_imap, "smtp": server("127.0.0.1", closed_port)},
    }
    bodies = {}
    for name, override in variants.items():
        response = await alice.client.post(PATH, json=box.payload(**override))
        assert response.status_code == 422, name
        error = response.json()["error"]
        assert error["code"] == "connection_failed", (name, error)
        bodies[name] = (error["code"], error["message"])
    assert len(set(bodies.values())) == 1  # same code, same text, nothing about the cause

    # An untrusted certificate is reported the same way.
    imap_registry.connector = MailConnector(allow_private_networks=True)  # test CA not trusted
    untrusted = await alice.client.post(PATH, json=box.payload())
    assert (untrusted.json()["error"]["code"], untrusted.json()["error"]["message"]) in set(
        bodies.values()
    )
    imap_registry.connector = ImapTestRegistry().connector

    no_tls = await alice.client.post(
        PATH, json=box.payload(imap=server(HOST, IMAP_PORT, "starttls"))
    )
    assert no_tls.json()["error"]["code"] == "tls_required"
    assert no_tls.json()["error"]["details"] == [{"field": "imap", "code": "tls_required"}]
    rejected = await alice.client.post(PATH, json=box.payload(password="wrong"))
    assert rejected.json()["error"]["code"] == "authentication_failed"
    bad_smtp_user = await alice.client.post(
        PATH, json=box.payload(smtp=server(HOST, SMTPS_PORT)) | {"username": box.email}
    )
    assert bad_smtp_user.status_code == 201  # sanity: the same settings do work
    for response in (untrusted, no_tls, rejected):
        text_ = response.text.lower()
        assert "greenmail" not in text_ and "certificate" not in text_ and "errno" not in text_
        assert "refused" not in text_ and "timed out" not in text_


# -- rate limit ----------------------------------------------------------------------------------


async def test_connect_attempts_are_rate_limited_per_user(alice, bob, guarded_registry):
    blocked = body(imap=server("127.0.0.1", 993))
    for _ in range(10):
        response = await alice.client.post(PATH, json=blocked)
        assert response.json()["error"]["code"] == "blocked_destination"
    limited = await alice.client.post(PATH, json=blocked)
    assert limited.status_code == 429 and limited.json()["error"]["code"] == "rate_limited"
    assert int(limited.headers["retry-after"]) > 0
    # Valid settings are refused too once the budget is spent, and nothing is probed.
    assert (await alice.client.post(PATH, json=body())).status_code == 429
    # Another user (same address in tests) still has their own budget...
    assert (await bob.client.post(PATH, json=blocked)).status_code == 422


async def test_connect_attempts_are_rate_limited_per_ip(
    alice, bob, actor_factory, guarded_registry
):
    blocked = body(imap=server("127.0.0.1", 993))
    carol = await actor_factory("carol@example.org")
    for actor in (alice, bob):
        for _ in range(10):
            assert (await actor.client.post(PATH, json=blocked)).status_code == 422
    # ...until the address itself has made 20 attempts, whoever is signed in.
    limited = await carol.client.post(PATH, json=blocked)
    assert limited.status_code == 429


async def test_reconnect_attempts_share_the_budget(alice, greenmail, imap_registry):
    box = greenmail.user(folders=False)
    created = await alice.client.post(PATH, json=box.payload())
    path = f"/api/v1/accounts/{created.json()['id']}/imap/credentials"
    for _ in range(9):
        assert (await alice.client.post(path, json={"password": "guess"})).status_code == 422
    assert (await alice.client.post(path, json={"password": box.password})).status_code == 429


# -- input validation ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        body(user_id=str(uuid.uuid4())),
        body(provider="gmail"),
        body(imap={"host": "imap.example.org", "port": 993, "security": "none"}),
        body(imap={"host": "imap.example.org", "port": 993, "security": "ssl", "verify": False}),
        body(imap={"host": "imap.example.org/x", "port": 993, "security": "ssl"}),
        body(imap={"host": "user@imap.example.org", "port": 993, "security": "ssl"}),
        body(imap={"host": "imap.example.org\r\nA1 LOGOUT", "port": 993, "security": "ssl"}),
        body(imap={"host": "", "port": 993, "security": "ssl"}),
        body(imap={"host": "imap.example.org", "port": 0, "security": "ssl"}),
        body(smtp={"host": "smtp.example.org", "port": 70000, "security": "ssl"}),
        body(username="user\r\nA1 DELETE INBOX"),
        body(username=""),
        body(password=""),
        body(password="x" * 1025),
        body(password="pass\nword"),
        body(email_address="not-an-email"),
        body(display_name="x" * 101),
        {k: v for k, v in body().items() if k != "password"},
    ],
)
async def test_malformed_requests_are_rejected_before_anything_is_contacted(
    alice, guarded_registry, monkeypatch, payload
):
    monkeypatch.setattr(guarded_registry, "verify_credentials", _must_not_run)
    response = await alice.client.post(PATH, json=payload)
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"
    assert "correct-horse" not in response.text and "pass\\nword" not in response.text


async def _must_not_run(*args: object, **kwargs: object) -> None:
    raise AssertionError("the mail servers must not be contacted")


async def test_unauthenticated_and_csrf_less_requests_are_refused(client, alice, guarded_registry):
    assert (await client.post(PATH, json=body())).status_code == 401
    del alice.client.headers["X-CSRF-Token"]
    assert (await alice.client.post(PATH, json=body())).status_code == 403


async def test_account_limit_is_checked_before_probing(
    alice, registry, guarded_registry, monkeypatch, owner_engine
):
    monkeypatch.setattr(guarded_registry, "verify_credentials", _must_not_run)
    async with owner_engine.begin() as conn:
        for i in range(10):
            await conn.execute(
                text(
                    "INSERT INTO email_accounts"
                    " (id, user_id, provider, email_address, display_name, color, status)"
                    " VALUES (:id, :user, 'gmail', :email, 'x', 'blue', 'active')"
                ),
                {"id": uuid.uuid4(), "user": alice.user_id, "email": f"m{i}@example.org"},
            )
    response = await alice.client.post(PATH, json=body())
    assert (
        response.status_code == 409 and response.json()["error"]["code"] == "account_limit_reached"
    )


# -- credential storage --------------------------------------------------------------------------


async def test_password_and_hosts_are_stored_only_encrypted(
    alice, greenmail, imap_registry, queue, owner_engine, services_for
):
    box = greenmail.user(folders=False)
    marker_host = HOST  # "localhost": must not appear in any plain column either
    created = await alice.client.post(PATH, json=box.payload())
    account_id = uuid.UUID(created.json()["id"])
    async with owner_engine.connect() as conn:
        rows = (
            await conn.execute(
                text("SELECT kind, key_id, nonce, ciphertext FROM account_credentials")
            )
        ).all()
        account_row = (await conn.execute(text("SELECT * FROM email_accounts"))).one()
        audit = (
            (await conn.execute(text("SELECT metadata::text FROM audit_events"))).scalars().all()
        )
        sync_rows = (
            (await conn.execute(text("SELECT row_to_json(s)::text FROM sync_states s")))
            .scalars()
            .all()
        )
    assert [r.kind for r in rows] == ["imap_password"]  # ONE secret: hosts, user name, password
    blob = rows[0].ciphertext
    for secret in (box.password, box.email, marker_host, str(IMAPS_PORT), "password", "imap"):
        assert secret.encode() not in blob
    assert len(rows[0].nonce) == 12
    plain_columns = " ".join(str(v) for v in account_row._mapping.values())
    assert box.password not in plain_columns and marker_host not in plain_columns
    for stored in (*audit, *sync_rows):
        assert box.password not in (stored or "") and marker_host not in (stored or "")
    # The queue carries identifiers only.
    assert queue.items == [(alice.user_id, account_id)]
    assert all(isinstance(part, uuid.UUID) for item in queue.items for part in item)

    async with services_for(alice.user_id) as svc:
        secret, expires_at = await svc.vault.read(
            user_id=alice.user_id, account_id=account_id, kind=CredentialKind.IMAP_PASSWORD
        )
        credentials = secret_to_server_credentials(secret)
        assert credentials.password == box.password and credentials.imap.host == HOST
        assert expires_at is None and box.password not in repr(credentials)


async def test_imap_secret_is_bound_to_its_owner_and_account(
    alice, bob, greenmail, imap_registry, owner_engine, services_for
):
    box, other = greenmail.user(folders=False), greenmail.user(folders=False)
    mine = uuid.UUID((await alice.client.post(PATH, json=box.payload())).json()["id"])
    theirs = uuid.UUID((await bob.client.post(PATH, json=other.payload())).json()["id"])
    # A database writer copies Alice's ciphertext over Bob's row.
    async with owner_engine.begin() as conn:
        await conn.execute(
            text(
                "UPDATE account_credentials b SET ciphertext = a.ciphertext, nonce = a.nonce,"
                " key_id = a.key_id FROM account_credentials a"
                " WHERE a.account_id = :mine AND b.account_id = :theirs"
            ),
            {"mine": mine, "theirs": theirs},
        )
    async with services_for(bob.user_id) as svc:
        with pytest.raises(VaultError):
            await svc.vault.read(
                user_id=bob.user_id, account_id=theirs, kind=CredentialKind.IMAP_PASSWORD
            )
    # Nor does the secret open as another kind of credential.
    async with owner_engine.begin() as conn:
        await conn.execute(
            text("UPDATE account_credentials SET kind = 'oauth_tokens' WHERE account_id = :mine"),
            {"mine": mine},
        )
    async with services_for(alice.user_id) as svc:
        with pytest.raises(VaultError):
            await svc.vault.read(
                user_id=alice.user_id, account_id=mine, kind=CredentialKind.OAUTH_TOKENS
            )


async def test_password_never_appears_in_api_responses(alice, greenmail, imap_registry):
    box = greenmail.user(folders=False)
    created = await alice.client.post(PATH, json=box.payload())
    account_id = created.json()["id"]
    renewed = await alice.client.post(
        f"/api/v1/accounts/{account_id}/imap/credentials", json={"password": box.password}
    )
    listings = [
        await alice.client.get(path)
        for path in (
            "/api/v1/accounts",
            "/api/v1/sync/status",
            "/api/v1/accounts/providers",
            "/api/v1/folders",
        )
    ]
    for response in (created, renewed, *listings):
        assert response.status_code in (200, 201)
        assert box.password not in response.text and "password" not in response.text.lower()
        assert str(IMAPS_PORT) not in response.text  # server settings are not echoed either


# -- tenant isolation ----------------------------------------------------------------------------


async def test_another_tenant_cannot_see_use_or_reconnect_an_imap_account(
    alice, bob, greenmail, imap_registry, runner, queue, owner_engine
):
    box = greenmail.user()
    box.deliver(mail("Private"))
    account_id = uuid.UUID((await alice.client.post(PATH, json=box.payload())).json()["id"])
    assert await runner.run(alice.user_id, account_id) == "ok"
    thread = (await alice.client.get("/api/v1/threads")).json()["items"][0]
    async with owner_engine.connect() as conn:
        before = (
            await conn.execute(text("SELECT ciphertext FROM account_credentials"))
        ).scalar_one()

    assert (await bob.client.get("/api/v1/accounts")).json()["items"] == []
    path = f"/api/v1/accounts/{account_id}/imap/credentials"
    for password in (box.password, "anything"):
        foreign = await bob.client.post(path, json={"password": password})
        assert foreign.status_code == 404 and foreign.json()["error"]["code"] == "not_found"
    unknown = await bob.client.post(
        f"/api/v1/accounts/{uuid.uuid4()}/imap/credentials", json={"password": "x"}
    )
    assert unknown.status_code == 404 and unknown.json() == foreign.json()  # indistinguishable
    assert (await bob.client.delete(f"/api/v1/accounts/{account_id}")).status_code == 404
    assert (await bob.client.post(f"/api/v1/sync/accounts/{account_id}")).status_code == 404
    assert (await bob.client.get(f"/api/v1/threads/{thread['id']}")).status_code == 404
    action = await bob.client.post(
        f"/api/v1/threads/{thread['id']}/actions", json={"action": "trash"}
    )
    assert action.status_code == 404
    assert await runner.run(bob.user_id, account_id) == "gone"  # a forged task cannot sync it
    forged = await bob.client.post(PATH, json=box.payload() | {"user_id": str(alice.user_id)})
    assert forged.status_code == 422

    async with owner_engine.connect() as conn:
        after = (
            await conn.execute(text("SELECT ciphertext FROM account_credentials"))
        ).scalar_one()
    assert after == before and box.uids("INBOX") == [1] and box.uids("Trash") == []
    assert (await alice.client.get("/api/v1/accounts")).json()["items"][0]["status"] == "active"

    # Bob may connect the same mailbox himself; it is a separate account with its own data.
    own = await bob.client.post(PATH, json=box.payload())
    assert own.status_code == 201 and own.json()["id"] != str(account_id)
    assert (await bob.client.get("/api/v1/threads")).json()["items"] == []
    assert len((await alice.client.get("/api/v1/accounts")).json()["items"]) == 1


async def test_oauth_account_cannot_be_given_a_password(alice, registry, imap_registry):
    from tests.conftest import connect_mailbox

    account_id = await connect_mailbox(alice, imap_registry, "alice.gmail@example.org")
    response = await alice.client.post(
        f"/api/v1/accounts/{account_id}/imap/credentials", json={"password": "x"}
    )
    assert response.status_code == 404
