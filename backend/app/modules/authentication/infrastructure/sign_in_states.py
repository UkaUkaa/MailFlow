"""Redis store for in-flight external sign-ins (state -> PKCE verifier, nonce, return path)."""

from __future__ import annotations

import json

from redis.asyncio import Redis

from app.modules.authentication.application.ports import PendingSignIn

_PREFIX = "mf:signin-state:"


class RedisSignInStateStore:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def put(self, state_hash: str, pending: PendingSignIn, ttl_seconds: int) -> None:
        payload = json.dumps(
            {
                "v": pending.code_verifier,
                "n": pending.nonce,
                "l": pending.locale,
                "p": pending.next_path,
            }
        )
        await self._redis.set(f"{_PREFIX}{state_hash}", payload, ex=ttl_seconds)

    async def take(self, state_hash: str) -> PendingSignIn | None:
        raw = await self._redis.getdel(f"{_PREFIX}{state_hash}")
        if raw is None:
            return None
        data = json.loads(raw)
        return PendingSignIn(
            code_verifier=str(data["v"]),
            nonce=str(data["n"]),
            locale=str(data["l"]),
            next_path=str(data["p"]),
        )
