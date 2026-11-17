from __future__ import annotations

import builtins
import uuid
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.database.engine import tenant_transaction
from app.integrations.email_providers.contracts import ProviderKind
from app.modules.email_accounts.domain import AccountStatus, EmailAccount, OAuthState
from app.modules.email_accounts.infrastructure.models import EmailAccountModel, OAuthStateModel


def _account(row: EmailAccountModel) -> EmailAccount:
    return EmailAccount(
        id=row.id,
        user_id=row.user_id,
        provider=ProviderKind(row.provider),
        email_address=row.email_address,
        display_name=row.display_name,
        color=row.color,
        status=AccountStatus(row.status),
        status_reason=row.status_reason,
        created_at=row.created_at,
    )


class SqlAccountRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def list(self, user_id: uuid.UUID) -> builtins.list[EmailAccount]:
        rows = await self._db.scalars(
            select(EmailAccountModel)
            .where(EmailAccountModel.user_id == user_id)
            .order_by(EmailAccountModel.created_at, EmailAccountModel.id)
            .execution_options(populate_existing=True)
        )
        return [_account(r) for r in rows]

    async def get(self, user_id: uuid.UUID, account_id: uuid.UUID) -> EmailAccount | None:
        row = await self._db.scalar(
            select(EmailAccountModel)
            .where(EmailAccountModel.id == account_id, EmailAccountModel.user_id == user_id)
            .execution_options(populate_existing=True)
        )
        return _account(row) if row else None

    async def get_by_address(
        self, user_id: uuid.UUID, provider: ProviderKind, email_address: str
    ) -> EmailAccount | None:
        row = await self._db.scalar(
            select(EmailAccountModel)
            .where(
                EmailAccountModel.user_id == user_id,
                EmailAccountModel.provider == provider.value,
                EmailAccountModel.email_address == email_address,
            )
            .execution_options(populate_existing=True)
        )
        return _account(row) if row else None

    async def add(
        self,
        *,
        user_id: uuid.UUID,
        provider: ProviderKind,
        email_address: str,
        display_name: str,
        color: str,
    ) -> EmailAccount:
        row = EmailAccountModel(
            user_id=user_id,
            provider=provider.value,
            email_address=email_address,
            display_name=display_name,
            color=color,
        )
        self._db.add(row)
        await self._db.flush()
        await self._db.refresh(row)
        return _account(row)

    async def update(
        self,
        user_id: uuid.UUID,
        account_id: uuid.UUID,
        *,
        display_name: str | None = None,
        color: str | None = None,
    ) -> None:
        values = {
            k: v for k, v in {"display_name": display_name, "color": color}.items() if v is not None
        }
        if values:
            await self._db.execute(
                update(EmailAccountModel)
                .where(EmailAccountModel.id == account_id, EmailAccountModel.user_id == user_id)
                .values(**values)
            )

    async def set_status(
        self, user_id: uuid.UUID, account_id: uuid.UUID, status: AccountStatus, reason: str | None
    ) -> None:
        await self._db.execute(
            update(EmailAccountModel)
            .where(EmailAccountModel.id == account_id, EmailAccountModel.user_id == user_id)
            .values(status=status.value, status_reason=reason)
        )

    async def delete(self, user_id: uuid.UUID, account_id: uuid.UUID) -> None:
        await self._db.execute(
            delete(EmailAccountModel).where(
                EmailAccountModel.id == account_id, EmailAccountModel.user_id == user_id
            )
        )


class SqlOAuthStateRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def add(
        self,
        *,
        user_id: uuid.UUID,
        provider: ProviderKind,
        state_hash: str,
        sealed_verifier: tuple[str, bytes, bytes],
        reconnect_account_id: uuid.UUID | None,
        locale: str,
        expires_at: datetime,
    ) -> None:
        key_id, nonce, ciphertext = sealed_verifier
        self._db.add(
            OAuthStateModel(
                user_id=user_id,
                provider=provider.value,
                state_hash=state_hash,
                verifier_key_id=key_id,
                verifier_nonce=nonce,
                verifier_ciphertext=ciphertext,
                reconnect_account_id=reconnect_account_id,
                locale=locale,
                expires_at=expires_at,
            )
        )
        await self._db.flush()

    async def consume(
        self, user_id: uuid.UUID, state_hash: str, now: datetime
    ) -> OAuthState | None:
        result = await self._db.execute(
            update(OAuthStateModel)
            .where(
                OAuthStateModel.state_hash == state_hash,
                OAuthStateModel.user_id == user_id,
                OAuthStateModel.consumed_at.is_(None),
                OAuthStateModel.expires_at > now,
            )
            .values(consumed_at=now)
            .returning(OAuthStateModel)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None
        return OAuthState(
            id=row.id,
            user_id=row.user_id,
            provider=ProviderKind(row.provider),
            sealed_verifier=(row.verifier_key_id, row.verifier_nonce, row.verifier_ciphertext),
            reconnect_account_id=row.reconnect_account_id,
            locale=row.locale,
        )

    async def delete_expired(self, user_id: uuid.UUID, now: datetime) -> None:
        await self._db.execute(
            delete(OAuthStateModel).where(
                OAuthStateModel.user_id == user_id, OAuthStateModel.expires_at < now
            )
        )


class IndependentAccountStatusMarker:
    """Writes account status in its own tenant-scoped transaction so the change survives
    the rollback of the request or task that discovered the problem."""

    def __init__(self, factory: async_sessionmaker[AsyncSession]) -> None:
        self._factory = factory

    async def mark(
        self, user_id: uuid.UUID, account_id: uuid.UUID, status: AccountStatus, reason: str | None
    ) -> None:
        async with tenant_transaction(self._factory, user_id) as session:
            await SqlAccountRepository(session).set_status(user_id, account_id, status, reason)
