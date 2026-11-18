# Backend modules

| Module | Responsibility | Owns tables |
|---|---|---|
| `authentication` | Registration, login, logout, sessions, email verification, password reset | `user_sessions`, `email_verification_tokens`, `password_reset_tokens` |
| `users` | User record, profile, deactivation, deletion orchestration | `users` |
| `token_vault` | Encrypt, store, read, rotate, delete provider credentials | `account_credentials` |
| `email_accounts` | Connect / reconnect / disconnect mailboxes, OAuth state, connection status | `email_accounts`, `oauth_states` |
| `emails` | Messages and threads: listing, reading, actions, composing, drafts | `email_messages`, `email_threads` |
| `folders` | System and provider folders/labels, unread counts | `email_folders`, `message_folders` |
| `attachments` | Attachment metadata, authorized streaming download | `attachments` |
| `outbox` | Scheduled sends: send later and undo send (D42); worker-side dispatch | `outbox_items`, `outbox_attachments` |
| `search` | Full-text search over the user's stored message metadata | — (reads `emails` through its public interface) |
| `synchronization` | Sync state, locks, initial/incremental/manual sync, scheduling | `sync_states` |
| `settings` | Per-user preferences (language, theme, remote images) | `user_settings` |
| `audit` | Minimal security audit trail | `audit_events` |

## Supporting packages

| Package | Purpose |
|---|---|
| `app.core.config` | Validated settings (pydantic-settings) |
| `app.core.database` | Engine, session factory, tenant context, declarative base |
| `app.core.security` | Password hashing, token generation, CSRF, SSRF guard, HTML sanitizer |
| `app.core.middleware` | Request ID, security headers, body limit, CSRF |
| `app.core.rate_limit` | Rate limiter port and Redis implementation |
| `app.integrations.email_providers` | Provider contract, capabilities, Gmail / Outlook / IMAP+SMTP adapters |
| `app.infrastructure.celery` | Celery app, task definitions, worker composition root |
| `app.infrastructure.mailer` | System mail (verification, reset) |

## Module layout

```
modules/<name>/
  __init__.py          public interface (re-exports only)
  domain/              entities, errors
  application/         use cases, ports, DTOs
  infrastructure/      models.py, repositories.py, adapters
  presentation/        router.py, schemas.py, dependencies.py
  README.md
```

Small modules collapse a layer into a single file (`domain.py`, `application.py`, ...). The
layer name is always present in the import path so the architecture tests can enforce rules.

## Dependency direction between modules

```
authentication ─> users
email_accounts ─> token_vault, synchronization(port)
emails ─> email_accounts, folders, token_vault, attachments
attachments ─> email_accounts, token_vault
search ─> emails
outbox ─> emails, settings
synchronization ─> email_accounts, emails, folders, attachments, token_vault
users (deletion) ─> authentication(port), email_accounts(port)
```

No cycles: where two modules need each other, the lower one declares a port and the higher one
supplies the implementation at composition time.
