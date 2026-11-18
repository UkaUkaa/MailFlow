"""Validated application configuration. The only place environment variables are read."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Local mail catchers (and "nothing configured"): mail sent there never reaches a real inbox.
_MAIL_CATCHERS = frozenset({"", "mailpit", "localhost", "127.0.0.1", "::1"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    api_docs_enabled: bool = False

    # Public URL of the application as seen by browsers (scheme + host, no trailing slash).
    app_base_url: str = "http://localhost:3000"
    allowed_hosts: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1"])
    # Extra origins allowed for state-changing requests / CORS in addition to app_base_url.
    allowed_origins: list[str] = Field(default_factory=list)

    database_url: str = (
        "postgresql+asyncpg://mailflow_app:dev_app_password@127.0.0.1:54329/mailflow"
    )
    database_migration_url: str = (
        "postgresql+asyncpg://mailflow_owner:dev_owner_password@127.0.0.1:54329/mailflow"
    )
    database_pool_size: int = 10
    database_max_overflow: int = 10
    db_app_role: str = "mailflow_app"

    redis_url: str = "redis://127.0.0.1:63799/0"
    celery_broker_url: str | None = None
    celery_result_backend: str | None = None

    session_cookie_name: str = "mf_session"
    csrf_cookie_name: str = "mf_csrf"
    session_ttl_hours: int = 24 * 14
    session_idle_timeout_hours: int = 24 * 7
    cookie_secure: bool | None = None
    cookie_domain: str | None = None

    require_email_verification: bool = True
    verification_token_ttl_hours: int = 24
    password_reset_token_ttl_minutes: int = 60

    # Token Vault. Comma separated "key_id:base64(32 bytes)".
    vault_keys: SecretStr = SecretStr("")
    vault_primary_key_id: str = ""

    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    google_redirect_uri: str | None = None
    # Microsoft identity platform application (Outlook / Microsoft 365 via Microsoft Graph).
    # Tenant: "common" (work, school and personal accounts), "organizations", "consumers"
    # or a tenant id.
    microsoft_client_id: str = ""
    microsoft_client_secret: SecretStr = SecretStr("")
    microsoft_tenant: str = "common"
    microsoft_redirect_uri: str | None = None
    oauth_state_ttl_minutes: int = 10

    smtp_host: str = ""
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_starttls: bool = False
    # Implicit TLS from the first byte (usually port 465). Mutually exclusive with STARTTLS.
    smtp_tls: bool = False
    mail_from: str = "MailFlow <no-reply@mailflow.local>"

    max_request_body_bytes: int = 30 * 1024 * 1024
    max_message_attachment_bytes: int = 25 * 1024 * 1024
    max_message_attachments: int = 20

    sync_interval_seconds: int = 120
    sync_initial_page_size: int = 25
    sync_pages_per_run: int = 4
    sync_backfill_max_messages: int = 5000
    sync_lock_ttl_seconds: int = 600
    provider_http_timeout_seconds: float = 20.0
    provider_max_concurrency: int = 4
    # Share of Gmail's 6,000 units/minute per-user quota that background sync may use.
    # The rest stays free for the user's own actions (open, send, archive ...).
    gmail_sync_units_per_minute: int = 3600
    # Share of Graph's 10,000 requests per 10 minutes (per application and mailbox) that
    # background sync may use; the rest stays free for the user's own actions.
    outlook_sync_requests_per_minute: int = 300
    sync_rate_limit_backoff_seconds: int = 90

    # Generic IMAP/SMTP mailboxes. Hosts come from users, so every connection goes through the
    # SSRF guard (public addresses, mail ports only) and verified TLS.
    mail_connect_timeout_seconds: float = 10.0
    mail_io_timeout_seconds: float = 30.0
    # TEST ONLY. Lets the integration tests reach the local mail server from
    # docker-compose.dev.yml: loopback/private addresses and its non-standard ports become
    # reachable, and one extra certificate authority is trusted. TLS and certificate
    # verification stay on. Both are refused unless ENVIRONMENT=test.
    ssrf_allow_private_networks: bool = False
    mail_tls_ca_file: str | None = None

    @model_validator(mode="after")
    def _validate(self) -> Settings:
        self.app_base_url = self.app_base_url.rstrip("/")
        self.microsoft_tenant = self.microsoft_tenant.strip() or "common"
        if "127.0.0.1" not in self.allowed_hosts:
            # Container health probes talk to the process directly on loopback.
            self.allowed_hosts = [*self.allowed_hosts, "127.0.0.1"]
        if self.environment != "test":
            if self.ssrf_allow_private_networks:
                raise ValueError(
                    "SSRF_ALLOW_PRIVATE_NETWORKS is only allowed when ENVIRONMENT=test"
                )
            if self.mail_tls_ca_file:
                raise ValueError("MAIL_TLS_CA_FILE is only allowed when ENVIRONMENT=test")
        if self.smtp_starttls and self.smtp_tls:
            raise ValueError("SMTP_STARTTLS and SMTP_TLS are mutually exclusive")
        if self.environment == "production":
            if self.smtp_host.strip().lower() in _MAIL_CATCHERS:
                raise ValueError(
                    "a real SMTP server (SMTP_HOST) must be configured in production; "
                    "verification and password reset emails are not delivered otherwise"
                )
            if not (self.smtp_starttls or self.smtp_tls):
                raise ValueError("SMTP_STARTTLS or SMTP_TLS must be enabled in production")
            if not self.app_base_url.startswith("https://"):
                raise ValueError("APP_BASE_URL must be https in production")
            if not self.vault_keys.get_secret_value():
                raise ValueError("VAULT_KEYS must be configured in production")
            if "dev_" in self.database_url:
                raise ValueError("development database credentials used in production")
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def secure_cookies(self) -> bool:
        if self.cookie_secure is not None:
            return self.cookie_secure
        return self.app_base_url.startswith("https://")

    @property
    def trusted_origins(self) -> set[str]:
        return {self.app_base_url, *(o.rstrip("/") for o in self.allowed_origins)}

    @property
    def broker_url(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def gmail_redirect_uri(self) -> str:
        return self.google_redirect_uri or (
            f"{self.app_base_url}/api/v1/accounts/oauth/gmail/callback"
        )

    @property
    def google_sign_in_redirect_uri(self) -> str:
        """Callback for "Sign in with Google" (MailFlow login, not mailbox access)."""
        return f"{self.app_base_url}/api/v1/auth/oauth/google/callback"

    @property
    def gmail_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret.get_secret_value())

    @property
    def outlook_redirect_uri(self) -> str:
        return self.microsoft_redirect_uri or (
            f"{self.app_base_url}/api/v1/accounts/oauth/outlook/callback"
        )

    @property
    def outlook_configured(self) -> bool:
        return bool(self.microsoft_client_id and self.microsoft_client_secret.get_secret_value())


@lru_cache
def get_settings() -> Settings:
    return Settings()
