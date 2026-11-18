"""Remote images are shown by default (D41); a user can still turn them off."""

from __future__ import annotations

import asyncio

from alembic import command
from alembic.config import Config
from sqlalchemy import text


async def test_new_user_sees_remote_images_by_default(alice):
    settings = (await alice.client.get("/api/v1/settings")).json()
    assert settings["load_remote_images"] is True


async def test_turning_remote_images_off_is_kept(alice):
    off = await alice.client.patch("/api/v1/settings", json={"load_remote_images": False})
    assert off.status_code == 200 and off.json()["load_remote_images"] is False
    assert (await alice.client.get("/api/v1/settings")).json()["load_remote_images"] is False
    # Changing an unrelated preference does not bring the default back.
    await alice.client.patch("/api/v1/settings", json={"theme": "dark"})
    assert (await alice.client.get("/api/v1/settings")).json()["load_remote_images"] is False


async def test_database_default_is_on(bob, owner_engine):
    async with owner_engine.begin() as conn:
        await conn.execute(text("DELETE FROM user_settings WHERE user_id = :u"), {"u": bob.user_id})
        await conn.execute(
            text(
                "INSERT INTO user_settings (user_id, locale, theme, conversation_view) "
                "VALUES (:u, 'en', 'system', true)"
            ),
            {"u": bob.user_id},
        )
        stored = await conn.scalar(
            text("SELECT load_remote_images FROM user_settings WHERE user_id = :u"),
            {"u": bob.user_id},
        )
    assert stored is True


async def test_migration_0005_keeps_existing_choice(alice, owner_engine):
    await alice.client.patch("/api/v1/settings", json={"load_remote_images": False})
    config = Config("alembic.ini")
    # Alembic runs its own event loop, so it goes to a worker thread.
    await asyncio.to_thread(command.downgrade, config, "0004")
    try:
        await asyncio.to_thread(command.upgrade, config, "0005")
    finally:
        await asyncio.to_thread(command.upgrade, config, "head")
    async with owner_engine.connect() as conn:
        stored = await conn.scalar(
            text("SELECT load_remote_images FROM user_settings WHERE user_id = :u"),
            {"u": alice.user_id},
        )
    assert stored is False
