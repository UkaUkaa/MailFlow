# Database

PostgreSQL 17. Schema is managed by Alembic (`backend/migrations`). UUID primary keys, UTC
`timestamptz` everywhere.

## Roles

| Role | Used by | Rights |
|---|---|---|
| `mailflow_owner` (`POSTGRES_USER`) | Alembic only | Owns all objects |
| `mailflow_app` | API, workers | `SELECT/INSERT/UPDATE/DELETE` on tables (no `DELETE` on `audit_events`), `EXECUTE` on two functions; no ownership, no `BYPASSRLS` |

## Tables

| Table | Owner module | Tenant RLS | Notes |
|---|---|---|---|
| `users` | users | no | `email` unique (lower-cased), `status` active/deactivated/deleting |
| `user_sessions` | authentication | no | `token_hash` unique |
| `email_verification_tokens`, `password_reset_tokens` | authentication | no | hashed, single-use |
| `audit_events` | audit | no | no FK to users by design |
| `user_settings` | settings | yes | PK = `user_id` |
| `email_accounts` | email_accounts | yes | unique `(user_id, provider, email_address)`; unique `(id, user_id)` |
| `oauth_states` | email_accounts | yes | hashed state, encrypted PKCE verifier |
| `account_credentials` | token_vault | yes | `key_id`, `nonce`, `ciphertext`; unique `(account_id, kind)` |
| `sync_states` | synchronization | yes | one per account; cursor, backfill token, `next_sync_at` |
| `email_folders` | folders | yes | unique `(account_id, provider_folder_id)` |
| `email_threads` | emails | yes | denormalized summary + view flags; unique `(account_id, provider_thread_id)` |
| `email_messages` | emails | yes | unique `(account_id, provider_message_id)`; generated `search_vector` |
| `attachments` | attachments | yes | metadata only |

All tenant tables reference `email_accounts (id, user_id)` with a composite foreign key and
`ON DELETE CASCADE`; `email_accounts` and `user_settings` reference `users` with cascade.
Deleting a user therefore removes everything they own.

## Indexes worth knowing

- `email_threads`: one partial index per mailbox view
  (`(user_id, last_message_at DESC, id DESC) WHERE in_inbox`, …) for keyset pagination.
- `email_messages`: GIN on `search_vector`, GIN on `folder_ids`, `(thread_id, sent_at)`.
- `sync_states (next_sync_at)` for the scheduler.

## Row-level security

`ENABLE ROW LEVEL SECURITY` on every tenant table with one policy:

```sql
USING      (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
```

The list of protected tables lives in `app/core/database/base.py::TENANT_TABLES`; a test fails if
a table with a `user_id` column is neither in that list nor a known authentication table.
`FORCE ROW LEVEL SECURITY` is deliberately not set: the owner role must be able to run the
definer functions and cascading deletes.

## Functions

| Function | Purpose |
|---|---|
| `mailflow_claim_due_syncs(limit, lease_seconds)` | Returns `(user_id, account_id)` for active mailboxes that are due, and leases them so they are not handed out twice |
| `mailflow_cleanup_expired()` | Deletes expired sessions, tokens, OAuth states and old audit rows |

Both are `SECURITY DEFINER` with a pinned `search_path`, executable only by `mailflow_app`.

## Migrations

```bash
cd backend && uv run alembic upgrade head
```

```bash
cd backend && uv run alembic revision --autogenerate -m "describe change"
```

A new tenant table must be added to `TENANT_TABLES`, get the policy and grants in its migration,
and get a cross-tenant test.

## Backups

Not automated. Minimum for production: scheduled `pg_dump` (or WAL archiving) of the `pgdata`
volume to encrypted off-host storage, with restore drills. Backups contain mail content and
encrypted credentials; the vault key must be backed up separately.
