"""Redis store for in-flight external sign-ins (state -> PKCE verifier, nonce, return path)."""

from __future__ import annotations

import json
import uuid

from redis.asyncio import Redis

from app.modules.authentication.application.ports import PendingSignIn, ReauthGrant
from app.modules.authentication.domain.entities import ReauthPurpose

_PREFIX = "mf:signin-state:"
_REAUTH_PREFIX = "mf:reauth-grant:"


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
                "u": str(pending.reauth_user_id) if pending.reauth_user_id else None,
                "r": pending.reauth_purpose.value if pending.reauth_purpose else None,
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
            reauth_user_id=uuid.UUID(data["u"]) if data.get("u") else None,
            reauth_purpose=ReauthPurpose(data["r"]) if data.get("r") else None,
        )


class RedisReauthGrantStore:
    """Single-use re-confirmation grants, keyed by the hash of the token held in a cookie."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def put(self, token_hash: str, grant: ReauthGrant, ttl_seconds: int) -> None:
        payload = json.dumps({"u": str(grant.user_id), "r": grant.purpose.value})
        await self._redis.set(f"{_REAUTH_PREFIX}{token_hash}", payload, ex=ttl_seconds)

    async def take(self, token_hash: str) -> ReauthGrant | None:
        raw = await self._redis.getdel(f"{_REAUTH_PREFIX}{token_hash}")
        if raw is None:
            return None
        data = json.loads(raw)
        return ReauthGrant(user_id=uuid.UUID(data["u"]), purpose=ReauthPurpose(data["r"]))
