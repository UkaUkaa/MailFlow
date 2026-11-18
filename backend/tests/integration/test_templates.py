"""Message templates: CRUD, validation, sanitization, tenant isolation."""

from __future__ import annotations

import uuid

TEMPLATES = "/api/v1/templates"


async def _create(actor, **body):
    payload = {
        "name": "Follow-up",
        "subject": "Checking in",
        "body_html": "<p>Hi {{first_name}}</p>",
    }
    response = await actor.client.post(TEMPLATES, json={**payload, **body})
    return response


async def test_template_lifecycle(alice):
    created = await _create(alice, name="  Zeta   reply ")
    assert created.status_code == 201, created.text
    template = created.json()
    assert template["name"] == "Zeta reply"
    assert template["body_html"] == "<p>Hi {{first_name}}</p>"
    assert (await _create(alice, name="alpha")).status_code == 201

    listed = (await alice.client.get(TEMPLATES)).json()["items"]
    assert [t["name"] for t in listed] == ["alpha", "Zeta reply"]

    patched = await alice.client.patch(f"{TEMPLATES}/{template['id']}", json={"subject": "New"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["subject"] == "New"
    assert patched.json()["name"] == "Zeta reply"

    deleted = await alice.client.delete(f"{TEMPLATES}/{template['id']}")
    assert deleted.status_code == 204
    assert [t["name"] for t in (await alice.client.get(TEMPLATES)).json()["items"]] == ["alpha"]


async def test_template_body_is_sanitized(alice):
    response = await _create(
        alice, body_html='<p onclick="x()">Hi</p><script>alert(1)</script><img src="javascript:1">'
    )
    assert response.status_code == 201, response.text
    body = response.json()["body_html"]
    assert "script" not in body and "onclick" not in body and "javascript" not in body
    assert "Hi" in body


async def test_template_validation(alice):
    blank = await _create(alice, name="   ")
    assert blank.status_code == 422
    assert blank.json()["error"]["code"] == "validation_error"
    too_long = await _create(alice, name="x" * 101)
    assert too_long.status_code == 422
    extra = await alice.client.post(TEMPLATES, json={"name": "a", "user_id": str(uuid.uuid4())})
    assert extra.status_code == 422


async def test_templates_are_isolated_between_users(alice, bob):
    template = (await _create(alice)).json()
    url = f"{TEMPLATES}/{template['id']}"

    assert (await bob.client.get(TEMPLATES)).json()["items"] == []
    assert (await bob.client.patch(url, json={"name": "mine"})).status_code == 404
    assert (await bob.client.delete(url)).status_code == 404
    assert (await alice.client.get(TEMPLATES)).json()["items"][0]["name"] == "Follow-up"


async def test_missing_template_is_404(alice):
    url = f"{TEMPLATES}/{uuid.uuid4()}"
    assert (await alice.client.patch(url, json={"name": "x"})).status_code == 404
    assert (await alice.client.delete(url)).status_code == 404
