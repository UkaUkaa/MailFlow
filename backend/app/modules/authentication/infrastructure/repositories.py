from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CursorResult, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.authentication.domain.entities import OneTimeTokenKind, Session
from app.modules.authentication.infrastructure.models import (
    EmailVerificationTokenModel,
    PasswordResetTokenModel,
    UserSessionModel,
)

_TOKEN_MODELS: dict[
    OneTimeTokenKind, type[EmailVerificationTokenModel] | type[PasswordResetTokenModel]
] = {
    OneTimeTokenKind.EMAIL_VERIFICATION: EmailVerificationTokenModel,
    OneTimeTokenKind.PASSWORD_RESET: PasswordResetTokenModel,
}


def _session(row: UserSessionModel) -> Session:
    return Session(
        id=row.id,
        user_id=row.user_id,
        created_at=row.created_at,
        last_seen_at=row.last_seen_at,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        user_agent=row.user_agent,
        ip_address=row.ip_address,
    )


def _rowcount(result: object) -> int:
    return int(result.rowcount) if isinstance(result, CursorResult) else 0


class SqlSessionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def add(
        self,
        *,
        user_id: uuid.UUID,
        token_hash: str,
        now: datetime,
        expires_at: datetime,
        user_agent: str | None,
        ip_address: str | None,
    ) -> Session:
        row = UserSessionModel(
            user_id=user_id,
            token_hash=token_hash,
            created_at=now,
            last_seen_at=now,
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        self._db.add(row)
        await self._db.flush()
        return _session(row)

    async def get_by_token_hash(self, token_hash: str) -> Session | None:
        row = await self._db.scalar(
            select(UserSessionModel).where(UserSessionModel.token_hash == token_hash)
        )
        return _session(row) if row else None

    async def touch(self, session_id: uuid.UUID, now: datetime) -> None:
        await self._db.execute(
            update(UserSessionModel)
            .where(UserSessionModel.id == session_id)
            .values(last_seen_at=now)
        )

    async def list_active(self, user_id: uuid.UUID, now: datetime) -> list[Session]:
        rows = await self._db.scalars(
            select(UserSessionModel)
            .where(
                UserSessionModel.user_id == user_id,
                UserSessionModel.revoked_at.is_(None),
                UserSessionModel.expires_at > now,
            )
            .order_by(UserSessionModel.last_seen_at.desc())
        )
        return [_session(r) for r in rows]

    async def revoke(self, user_id: uuid.UUID, session_id: uuid.UUID, now: datetime) -> bool:
        result = await self._db.execute(
            update(UserSessionModel)
            .where(
                UserSessionModel.id == session_id,
                UserSessionModel.user_id == user_id,
                UserSessionModel.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        return _rowcount(result) > 0

    async def revoke_all(
        self, user_id: uuid.UUID, now: datetime, *, except_id: uuid.UUID | None = None
    ) -> None:
        stmt = (
            update(UserSessionModel)
            .where(UserSessionModel.user_id == user_id, UserSessionModel.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        if except_id is not None:
            stmt = stmt.where(UserSessionModel.id != except_id)
        await self._db.execute(stmt)

    async def delete_expired(self, before: datetime) -> int:
        result = await self._db.execute(
            delete(UserSessionModel).where(UserSessionModel.expires_at < before)
        )
        return _rowcount(result)


class SqlOneTimeTokenRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def add(
        self, kind: OneTimeTokenKind, *, user_id: uuid.UUID, token_hash: str, expires_at: datetime
    ) -> None:
        self._db.add(
            _TOKEN_MODELS[kind](user_id=user_id, token_hash=token_hash, expires_at=expires_at)
        )
        await self._db.flush()

    async def consume(
        self, kind: OneTimeTokenKind, token_hash: str, now: datetime
    ) -> uuid.UUID | None:
        model = _TOKEN_MODELS[kind]
        # Single UPDATE ... RETURNING: two concurrent requests cannot both consume the token.
        result = await self._db.execute(
            update(model)
            .where(model.token_hash == token_hash, model.used_at.is_(None), model.expires_at > now)
            .values(used_at=now)
            .returning(model.user_id)
        )
        return result.scalar_one_or_none()

    async def invalidate_all(self, kind: OneTimeTokenKind, user_id: uuid.UUID) -> None:
        model = _TOKEN_MODELS[kind]
        await self._db.execute(delete(model).where(model.user_id == user_id))

    async def delete_expired(self, before: datetime) -> int:
        total = 0
        for model in _TOKEN_MODELS.values():
            result = await self._db.execute(delete(model).where(model.expires_at < before))
            total += _rowcount(result)
        return total
