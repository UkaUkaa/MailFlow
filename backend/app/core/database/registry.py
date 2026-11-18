"""Imports every ORM model so ``Base.metadata`` is complete (Alembic, tests)."""

from app.core.database.base import Base
from app.modules.attachments.infrastructure import AttachmentModel
from app.modules.audit.infrastructure import AuditEventModel
from app.modules.authentication.infrastructure.models import (
    EmailVerificationTokenModel,
    PasswordResetTokenModel,
    UserIdentityModel,
    UserSessionModel,
)
from app.modules.email_accounts.infrastructure.models import EmailAccountModel, OAuthStateModel
from app.modules.emails.infrastructure.models import EmailMessageModel, EmailThreadModel
from app.modules.folders.infrastructure import EmailFolderModel
from app.modules.settings.infrastructure import UserSettingsModel
from app.modules.synchronization.infrastructure import SyncStateModel
from app.modules.token_vault.infrastructure import AccountCredentialModel
from app.modules.users.infrastructure import UserModel

__all__ = [
    "AccountCredentialModel",
    "AttachmentModel",
    "AuditEventModel",
    "Base",
    "EmailAccountModel",
    "EmailFolderModel",
    "EmailMessageModel",
    "EmailThreadModel",
    "EmailVerificationTokenModel",
    "OAuthStateModel",
    "PasswordResetTokenModel",
    "SyncStateModel",
    "UserIdentityModel",
    "UserModel",
    "UserSessionModel",
    "UserSettingsModel",
]
