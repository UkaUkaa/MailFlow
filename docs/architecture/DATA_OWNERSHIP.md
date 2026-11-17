# Data ownership and tenant isolation

## Ownership model

```
users
 ├─ user_sessions, email_verification_tokens, password_reset_tokens
 ├─ user_settings
 ├─ oauth_states
 └─ email_accounts
      ├─ account_credentials        (Token Vault ciphertext)
      ├─ sync_states
      ├─ email_folders
      ├─ email_threads
      └─ email_messages
           ├─ message_folders
           └─ attachments
```

Every table below `users` carries a non-null `user_id` (denormalised on purpose, even where it
could be derived through `account_id`) so that:

- every query can filter on `user_id` directly,
- one uniform RLS policy applies to every tenant table,
- composite foreign keys `(account_id, user_id)` make it impossible for a row to point at another
  tenant's account.

Deleting a user cascades through the whole tree (`ON DELETE CASCADE`).

## Layer 1 — application ownership checks (authoritative)

- `user_id` comes from the server-side session only.
- Repository methods for tenant data take `user_id` as a required argument and include it in the
  `WHERE` clause. There is no "get by id" without an owner.
- A missing row and a foreign row are indistinguishable: both raise `NotFoundError` → HTTP 404.
- Provider identifiers are unique only per account: `UNIQUE (account_id, provider_message_id)`.

## Layer 2 — PostgreSQL Row-Level Security (defense in depth)

- The application connects as `mailflow_app`, a role that is **not** the table owner and has no
  `BYPASSRLS`. Migrations run as the owner role.
- Tenant tables have `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` and one policy:

  ```sql
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid)
  ```

- The context is set per transaction with `SELECT set_config('app.current_user_id', :id, true)`.
  `true` = transaction-local, so the value disappears at commit/rollback and cannot leak to the
  next user of a pooled connection. With no context the setting is NULL and every policy is false.
- Tables consulted before a user is known (`users`, `user_sessions`, verification and reset
  tokens, `oauth_states`, `audit_events`) are not under RLS; they are reached only through the
  authentication module with hashed-token lookups.
- Cross-tenant operational reads needed by the scheduler go through narrowly scoped
  `SECURITY DEFINER` functions that return IDs only (e.g. `mailflow_accounts_due_for_sync`).

## Background workers

Tasks receive `(user_id, account_id)` — identifiers, never credentials. The worker sets the tenant
context to `user_id`, then loads the account by `(account_id, user_id)`. A mismatched pair simply
finds nothing. Disconnected or deleted accounts are detected the same way and the task exits.

## Caches and locks

Every Redis key that holds tenant data or tenant-specific state is prefixed with the owner:
`mf:u:{user_id}:...`. Deleting a user removes that prefix.

## Tests

`backend/tests/security/test_tenant_isolation.py` covers cross-user access to accounts, threads,
messages, folders, attachments, settings, sessions, sync state, search and credentials, plus RLS
behaviour with pooled-connection reuse and concurrent transactions.
