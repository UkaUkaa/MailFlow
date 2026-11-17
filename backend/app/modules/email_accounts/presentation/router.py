from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator

from app.api.deps import Auth, Svc
from app.core.dependencies import SettingsDep, rate_limit
from app.integrations.email_providers.contracts import (
    FolderRole,
    MailEndpoint,
    MailSecurity,
    ProviderKind,
    ServerCredentials,
)
from app.modules.email_accounts.domain import EmailAccount
from app.modules.synchronization.domain import SyncState
from app.shared.domain.errors import NotFoundError

router = APIRouter(prefix="/accounts", tags=["accounts"])

OAUTH_PROVIDERS = {ProviderKind.GMAIL, ProviderKind.OUTLOOK}


class SyncInfo(BaseModel):
    status: str
    last_synced_at: datetime | None
    last_error_code: str | None


class AccountOut(BaseModel):
    id: uuid.UUID
    provider: str
    email_address: str
    display_name: str
    color: str
    status: str
    status_reason: str | None
    capabilities: dict[str, bool]
    created_at: datetime
    sync: SyncInfo


class AccountList(BaseModel):
    items: list[AccountOut]


class ProviderOut(BaseModel):
    kind: str
    available: bool
    capabilities: dict[str, bool]


class ProviderList(BaseModel):
    items: list[ProviderOut]


class StartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    locale: Literal["en", "uk"] | None = None


class AuthorizationUrl(BaseModel):
    authorization_url: str


class AccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = Field(default=None, max_length=16)


class MailServerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)
    security: MailSecurity

    @field_validator("host")
    @classmethod
    def _host(cls, value: str) -> str:
        value = value.strip().lower()
        # Shape only. Whether the address may be contacted is decided by the SSRF guard.
        if not value or any(c.isspace() or c in "/@\\#?%" or ord(c) < 33 for c in value):
            raise ValueError("invalid host")
        return value

    def endpoint(self) -> MailEndpoint:
        return MailEndpoint(self.host, self.port, self.security)


def _no_control_characters(value: str) -> str:
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("control characters are not allowed")
    return value


class ImapConnectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email_address: EmailStr
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    imap: MailServerIn
    smtp: MailServerIn
    username: str = Field(min_length=1, max_length=255)
    # SecretStr keeps the password out of reprs, validation errors and tracebacks.
    password: SecretStr = Field(min_length=1, max_length=1024)

    _clean_username = field_validator("username")(_no_control_characters)

    @field_validator("password")
    @classmethod
    def _password(cls, value: SecretStr) -> SecretStr:
        _no_control_characters(value.get_secret_value())
        return value


class ImapPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: SecretStr = Field(min_length=1, max_length=1024)

    @field_validator("password")
    @classmethod
    def _password(cls, value: SecretStr) -> SecretStr:
        _no_control_characters(value.get_secret_value())
        return value


# Mailbox features that exist only when the mailbox has a folder for them.
_FOLDER_CAPABILITIES = {
    "archive": FolderRole.ARCHIVE,
    "spam": FolderRole.SPAM,
    "drafts": FolderRole.DRAFTS,
}


async def _folder_roles(svc: Svc, user_id: uuid.UUID) -> dict[uuid.UUID, set[FolderRole]]:
    roles: dict[uuid.UUID, set[FolderRole]] = {}
    for folder in await svc.folders.list(user_id):
        roles.setdefault(folder.account_id, set()).add(folder.role)
    return roles


def _capabilities(
    account: EmailAccount, svc: Svc, roles: dict[uuid.UUID, set[FolderRole]]
) -> dict[str, bool]:
    """What this mailbox can do. Folder-based providers (IMAP) can archive, mark spam or keep
    drafts only when the mailbox has such a folder, so those flags are per account."""
    capabilities = svc.registry.capabilities(account.provider)
    result = capabilities.as_dict()
    if account.provider is ProviderKind.IMAP:
        present = roles.get(account.id, set())
        for name, role in _FOLDER_CAPABILITIES.items():
            result[name] = result[name] and role in present
    return result


def _account_out(
    account: EmailAccount,
    state: SyncState | None,
    svc: Svc,
    roles: dict[uuid.UUID, set[FolderRole]],
) -> AccountOut:
    return AccountOut(
        id=account.id,
        provider=account.provider.value,
        email_address=account.email_address,
        display_name=account.display_name,
        color=account.color,
        status=account.status.value,
        status_reason=account.status_reason,
        capabilities=_capabilities(account, svc, roles),
        created_at=account.created_at,
        sync=SyncInfo(
            status=state.status.value if state else "idle",
            last_synced_at=state.last_synced_at if state else None,
            last_error_code=state.last_error_code if state else None,
        ),
    )


def _oauth_provider(provider: str) -> ProviderKind:
    try:
        kind = ProviderKind(provider)
    except ValueError as exc:
        raise NotFoundError from exc
    if kind not in OAUTH_PROVIDERS:
        raise NotFoundError
    return kind


@router.get("/providers", response_model=ProviderList)
async def list_providers(svc: Svc) -> ProviderList:
    return ProviderList(
        items=[
            ProviderOut(
                kind=kind.value,
                available=svc.registry.is_available(kind),
                capabilities=svc.registry.capabilities(kind).as_dict(),
            )
            for kind in ProviderKind
        ]
    )


@router.get("", response_model=AccountList)
async def list_accounts(auth: Auth, svc: Svc) -> AccountList:
    accounts = await svc.accounts.list(auth.user_id)
    states = await svc.sync_requests.status(auth.user_id)
    roles = await _folder_roles(svc, auth.user_id)
    return AccountList(items=[_account_out(a, states.get(a.id), svc, roles) for a in accounts])


@router.post(
    "/imap",
    response_model=AccountOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("imap-connect", limit=20, window_seconds=3600))],
)
async def connect_imap(
    body: ImapConnectRequest, response: Response, auth: Auth, svc: Svc
) -> AccountOut:
    """Connect a mailbox by IMAP/SMTP. Both logins are tried before anything is stored."""
    account, created = await svc.connect_accounts.connect_with_password(
        auth.user_id,
        email_address=str(body.email_address),
        display_name=body.display_name,
        credentials=ServerCredentials(
            imap=body.imap.endpoint(),
            smtp=body.smtp.endpoint(),
            username=body.username,
            password=body.password.get_secret_value(),
        ),
    )
    if not created:
        response.status_code = status.HTTP_200_OK
    states = await svc.sync_requests.status(auth.user_id)
    return _account_out(
        account, states.get(account.id), svc, await _folder_roles(svc, auth.user_id)
    )


@router.post(
    "/{account_id}/imap/credentials",
    response_model=AccountOut,
    dependencies=[Depends(rate_limit("imap-connect", limit=20, window_seconds=3600))],
)
async def update_imap_credentials(
    account_id: uuid.UUID, body: ImapPasswordRequest, auth: Auth, svc: Svc
) -> AccountOut:
    """Reconnect an IMAP mailbox with a new password (servers and user name stay as stored)."""
    account = await svc.connect_accounts.update_password(
        auth.user_id, account_id, body.password.get_secret_value()
    )
    states = await svc.sync_requests.status(auth.user_id)
    return _account_out(
        account, states.get(account.id), svc, await _folder_roles(svc, auth.user_id)
    )


@router.post("/oauth/{provider}/start", response_model=AuthorizationUrl)
async def start_oauth(
    provider: str, auth: Auth, svc: Svc, body: StartRequest | None = None
) -> AuthorizationUrl:
    url = await svc.connect_accounts.start(
        auth.user_id, _oauth_provider(provider), locale=body.locale if body else None
    )
    return AuthorizationUrl(authorization_url=url)


@router.get("/oauth/{provider}/callback", include_in_schema=False)
async def oauth_callback(
    provider: str,
    auth: Auth,
    svc: Svc,
    settings: SettingsDep,
    code: Annotated[str | None, Query(max_length=8192)] = None,
    state: Annotated[str | None, Query(max_length=512)] = None,
    error: Annotated[str | None, Query(max_length=200)] = None,
) -> RedirectResponse:
    """Provider redirect target. Requires the user's session (SameSite=Lax cookies are sent
    on this top-level navigation) and a state issued to that same user."""
    outcome = await svc.connect_accounts.complete(
        auth.user_id, _oauth_provider(provider), code=code, state=state, provider_error=error
    )
    params = (
        {"connected": str(outcome.account_id)}
        if outcome.account_id
        else {"error": outcome.error or "unknown"}
    )
    # The target is built from server configuration only — never from request input.
    target = f"{settings.app_base_url}/{outcome.locale}/settings/accounts?{urlencode(params)}"
    return RedirectResponse(target, status_code=status.HTTP_302_FOUND)


@router.post("/{account_id}/reconnect", response_model=AuthorizationUrl)
async def reconnect(
    account_id: uuid.UUID, auth: Auth, svc: Svc, body: StartRequest | None = None
) -> AuthorizationUrl:
    account = await svc.accounts.get(auth.user_id, account_id)
    url = await svc.connect_accounts.start(
        auth.user_id,
        account.provider,
        locale=body.locale if body else None,
        reconnect_account_id=account.id,
    )
    return AuthorizationUrl(authorization_url=url)


@router.patch("/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: uuid.UUID, body: AccountUpdate, auth: Auth, svc: Svc
) -> AccountOut:
    account = await svc.accounts.update(
        auth.user_id, account_id, display_name=body.display_name, color=body.color
    )
    states = await svc.sync_requests.status(auth.user_id)
    return _account_out(
        account, states.get(account.id), svc, await _folder_roles(svc, auth.user_id)
    )


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_account(account_id: uuid.UUID, auth: Auth, svc: Svc) -> None:
    await svc.accounts.disconnect(auth.user_id, account_id)
