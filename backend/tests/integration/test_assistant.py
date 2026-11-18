"""AI replies with each user's own key (D43): connect, drafting, ownership, limits."""

from __future__ import annotations

from dataclasses import replace

from sqlalchemy import text

from app.integrations.email_providers.contracts import Address, FolderRole
from app.modules.assistant.domain import AiProvider, DraftKind
from tests.conftest import connect_ai, connect_mailbox
from tests.fakes import make_message

R = FolderRole
MAILBOX = "a@example.org"
ASSISTANT = "/api/v1/assistant"
REPLY = "/api/v1/assistant/reply"
COMPOSE = "/api/v1/assistant/compose"
KEY = "sk-proj-SECRETVALUE-9876"


async def _conversation(actor, registry, runner) -> str:
    """A thread (my message, then Olena's question) and an older note of mine to Olena."""
    account_id = await connect_mailbox(actor, registry, MAILBOX)
    mailbox = registry.mailbox(MAILBOX)
    me = Address(email=MAILBOX, name="Alice")
    olena = Address(email="olena@example.com", name="Olena")
    mailbox.add(
        replace(
            make_message("mine1", thread_id="t1", subject="Зустріч", roles=frozenset({R.SENT}),
                         minutes=1, is_read=True, body_html="<p>Може зустрінемось?</p>"),
            sender=me, to=(olena,),
        ),
        record=False,
    )  # fmt: skip
    mailbox.add(
        replace(
            make_message(
                "in1", thread_id="t1", subject="Re: Зустріч", minutes=2,
                body_html=(
                    "<p>Привіт! Давай у четвер?</p>"
                    "<p>On Mon, Jan 1, 2026 Alice wrote:</p><p>&gt; Може зустрінемось?</p>"
                ),
            ),
            sender=olena,
        ),
        record=False,
    )  # fmt: skip
    mailbox.add(
        replace(
            make_message("old", subject="Фото", roles=frozenset({R.SENT}), minutes=0,
                         is_read=True, body_html="<p>Привіт, Олено!</p><p>Обіймаю, Аліса</p>"),
            sender=me, to=(olena,),
        ),
        record=False,
    )  # fmt: skip
    assert await runner.run(actor.user_id, account_id) == "ok"
    threads = (await actor.client.get("/api/v1/threads", params={"view": "inbox"})).json()["items"]
    thread = next(t for t in threads if "Зустріч" in t["subject"])
    detail = (await actor.client.get(f"/api/v1/threads/{thread['id']}")).json()
    return next(m["id"] for m in detail["messages"] if m["from"]["email"] == "olena@example.com")


async def test_not_configured_until_the_user_adds_a_key(alice, registry, runner, ai):
    assert (await alice.client.get(ASSISTANT)).json() == {
        "configured": False, "provider": None, "model": None, "key_hint": None, "models": [],
    }  # fmt: skip
    source = await _conversation(alice, registry, runner)
    response = await alice.client.post(REPLY, json={"source_message_id": source})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "assistant_not_configured"
    assert ai.requests == []


async def test_connect_checks_the_key_and_never_returns_it(alice, ai, owner_engine):
    response = await alice.client.put(
        ASSISTANT, json={"provider": "openai", "api_key": f"  {KEY} "}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "configured": True,
        "provider": "openai",
        "model": "gpt-5",  # preferred model the key can use
        "key_hint": "9876",
        "models": ["gpt-5-mini", "gpt-5", "gpt-4o"],
    }
    assert ai.listed == [(AiProvider.OPENAI, KEY)]
    assert KEY not in response.text
    assert KEY not in (await alice.client.get(ASSISTANT)).text
    # Stored only as Token Vault ciphertext.
    async with owner_engine.connect() as conn:
        stored = (await conn.execute(text("SELECT ciphertext FROM user_secrets"))).scalar_one()
    assert KEY.encode() not in stored and b"9876" not in stored


async def test_rejected_or_malformed_keys_are_not_stored(alice, ai, owner_engine):
    ai.rejected_keys.add(KEY)
    rejected = await alice.client.put(ASSISTANT, json={"provider": "gemini", "api_key": KEY})
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "assistant_key_invalid"
    malformed = await alice.client.put(ASSISTANT, json={"provider": "gemini", "api_key": "a b"})
    assert malformed.status_code == 422
    unknown = await alice.client.put(ASSISTANT, json={"provider": "acme", "api_key": KEY})
    assert unknown.status_code == 422
    assert len(ai.listed) == 1  # only the plausible key reached the provider
    assert (await alice.client.get(ASSISTANT)).json()["configured"] is False
    async with owner_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM user_secrets"))).scalar_one() == 0


async def test_choose_model_switch_provider_and_disconnect(alice, ai, owner_engine):
    await connect_ai(alice, "anthropic", KEY)
    chosen = await alice.client.patch(ASSISTANT, json={"model": "claude-sonnet-5-5"})
    assert chosen.json()["model"] == "claude-sonnet-5-5"
    unknown = await alice.client.patch(ASSISTANT, json={"model": "gpt-5"})
    assert unknown.status_code == 422

    switched = await connect_ai(alice, "gemini", "AIza-other-key-0001")
    assert (switched["provider"], switched["model"], switched["key_hint"]) == (
        "gemini", "gemini-2.5-pro", "0001",
    )  # fmt: skip

    assert (await alice.client.delete(ASSISTANT)).status_code == 204
    assert (await alice.client.get(ASSISTANT)).json()["configured"] is False
    async with owner_engine.connect() as conn:
        for table in ("user_secrets", "assistant_configs"):
            assert (await conn.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one() == 0


async def test_drafts_with_the_users_own_provider_style_and_context(alice, registry, runner, ai):
    source = await _conversation(alice, registry, runner)
    await connect_ai(alice, "gemini", KEY)
    ai.body = "Привіт!\n\n<b>Так</b>, четвер підходить.\nОбіймаю, Аліса"

    response = await alice.client.post(
        REPLY, json={"source_message_id": source, "instruction": "  yes, thursday works  "}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "language": "uk",
        "body_html": "<p>Привіт!</p><p>&lt;b&gt;Так&lt;/b&gt;, четвер підходить.<br>Обіймаю, Аліса</p>",
    }
    assert ai.writers == [(AiProvider.GEMINI, KEY, "gemini-2.5-pro")]
    (request,) = ai.requests
    assert request.instruction == "yes, thursday works"
    assert request.my_email == MAILBOX
    assert request.correspondent_email == "olena@example.com"
    assert [(e.is_mine, e.text) for e in request.thread] == [
        (True, "Може зустрінемось?"),
        (False, "Привіт! Давай у четвер?"),  # the quoted earlier message is gone
    ]
    # My other mail to Olena is a style sample; messages already in the thread are not.
    assert len(request.style_samples) == 1
    assert "Обіймаю, Аліса" in request.style_samples[0]


async def test_keys_and_messages_stay_with_their_owner(alice, bob, registry, runner, ai):
    source = await _conversation(alice, registry, runner)
    await connect_ai(alice, "openai", KEY)
    assert (await bob.client.get(ASSISTANT)).json()["configured"] is False
    # Bob has no key: Alice's is never used for him.
    no_key = await bob.client.post(REPLY, json={"source_message_id": source})
    assert no_key.status_code == 409
    await connect_ai(bob, "anthropic", "sk-ant-bob-key-5555")
    foreign = await bob.client.post(REPLY, json={"source_message_id": source})
    assert foreign.status_code == 404
    assert ai.requests == []


async def test_instruction_length_and_rate_limits(alice, registry, runner, ai, runtime):
    source = await _conversation(alice, registry, runner)
    await connect_ai(alice)
    too_long = await alice.client.post(
        REPLY, json={"source_message_id": source, "instruction": "x" * 2001}
    )
    assert too_long.status_code == 422

    runtime.settings = runtime.settings.model_copy(update={"assistant_requests_per_hour": 2})
    codes = [
        (await alice.client.post(REPLY, json={"source_message_id": source})).status_code
        for _ in range(3)
    ]
    assert codes == [200, 200, 429]


async def test_key_checks_are_rate_limited(alice, ai):
    ai.rejected_keys.add(KEY)
    codes = [
        (await alice.client.put(ASSISTANT, json={"provider": "openai", "api_key": KEY})).status_code
        for _ in range(11)
    ]
    assert codes == [422] * 10 + [429]


async def _account_id(actor) -> str:
    accounts = (await actor.client.get("/api/v1/accounts")).json()["items"]
    return next(a["id"] for a in accounts if a["email_address"] == MAILBOX)


async def test_drafts_a_new_email_from_the_chosen_mailbox(alice, registry, runner, ai):
    await _conversation(alice, registry, runner)
    account_id = await _account_id(alice)
    await connect_ai(alice, "anthropic", KEY)
    ai.subject = "  Фото\n з поїздки "
    ai.body = "Привіт, Олено!\n\nНадсилаю фото.\nОбіймаю, Аліса"

    response = await alice.client.post(
        COMPOSE,
        json={
            "account_id": account_id,
            "instruction": " send Olena the trip photos ",
            "recipient_email": "olena@example.com",
            "recipient_name": "Olena",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "language": "uk",
        "subject": "Фото з поїздки",
        "body_html": "<p>Привіт, Олено!</p><p>Надсилаю фото.<br>Обіймаю, Аліса</p>",
    }
    (request,) = ai.requests
    assert request.kind is DraftKind.NEW
    assert request.instruction == "send Olena the trip photos"
    assert request.my_email == MAILBOX
    assert request.correspondent_email == "olena@example.com"
    assert request.thread == ()
    assert request.style_samples  # the user's own sent mail to Olena


async def test_forward_note_uses_the_forwarded_message_and_keeps_the_subject(
    alice, registry, runner, ai
):
    source = await _conversation(alice, registry, runner)
    await connect_ai(alice)
    ai.subject = "should be ignored"
    response = await alice.client.post(
        COMPOSE,
        json={
            "account_id": await _account_id(alice),
            "subject": "Fwd: Зустріч",
            "forwarded_message_id": source,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["subject"] == ""
    (request,) = ai.requests
    assert request.kind is DraftKind.FORWARD
    assert [e.text for e in request.thread] == ["Привіт! Давай у четвер?"]


async def test_new_email_drafting_stays_with_its_owner(alice, bob, registry, runner, ai):
    source = await _conversation(alice, registry, runner)
    account_id = await _account_id(alice)
    await connect_ai(bob, "anthropic", "sk-ant-bob-key-5555")
    bob_account = str(await connect_mailbox(bob, registry, "b@example.org"))
    foreign_account = await bob.client.post(COMPOSE, json={"account_id": account_id})
    assert foreign_account.status_code == 404
    foreign_message = await bob.client.post(
        COMPOSE, json={"account_id": bob_account, "forwarded_message_id": source}
    )
    assert foreign_message.status_code == 404
    assert ai.requests == []
