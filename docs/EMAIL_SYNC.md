# Email synchronization

Code: `app/modules/synchronization`, `app/infrastructure/celery`.

## Components

| Piece | Role |
|---|---|
| `celery_beat` | Every 30 s runs `sync.schedule_due`; hourly runs `maintenance.cleanup` |
| `sync.schedule_due` | Calls `mailflow_claim_due_syncs` and enqueues one `sync.account` per claimed mailbox |
| `sync.account(user_id, account_id)` | Runs `SyncRunner` for one mailbox |
| `SyncRequestService` | API side: manual sync and status |
| `sync_states` | Cursor, backfill position, status, error, `next_sync_at` |

Tasks carry only identifiers. The worker re-reads the account in a tenant-scoped transaction,
checks that the account and its owner are active, and obtains credentials from the Token Vault.

## One run

1. Take the per-account Redis lock (`mf:u:{user}:acct:{account}:sync`). If held → exit.
2. Mark the state `running`.
3. **Folders**: replace the stored folder list with the provider's.
4. **Changes** (when a cursor exists): `provider.synchronize(cursor)` → fetch changed messages →
   upsert → delete removed → store the new cursor.
   If the cursor expired: purge the mailbox's local copy and restart from the first page.
5. **Backfill**: up to `SYNC_PAGES_PER_RUN` pages of the message listing, newest first. The first
   page also records the history cursor (captured *before* listing so nothing is missed). Each
   page is its own transaction, so a crash loses at most one page.
   The cursor is opaque to the runner: Gmail's is a history id, Outlook's carries one delta link
   per folder and may take several runs to cover a large mailbox (see `EMAIL_INTEGRATION.md`).
6. Mark `idle`, set `next_sync_at = now + SYNC_INTERVAL_SECONDS`.

On failure the state becomes `error` with the error code and `next_sync_at` backs off
exponentially (capped at one hour). An authorization failure marks the account `needs_reauth` and
stops scheduling until the user reconnects.

## Guarantees

- **Idempotent**: messages are upserted on `(account_id, provider_message_id)`; replaying a page
  or a history record changes nothing.
- **Isolated**: each mailbox is its own task with its own lock and error state; one failing
  mailbox never blocks another.
- **Restart-safe**: `task_acks_late` redelivers a task if its worker dies; a stale `running` state
  is reclaimed when its lease (`next_sync_at`) expires.
- **Bounded**: the scheduler claims at most 200 mailboxes per tick and leases each one, the worker
  prefetches one task, provider calls per mailbox are capped by a semaphore, and tasks have hard
  and soft time limits.
- **Deletion-safe**: a task for a disconnected, deleted or foreign account finds no row and exits.

## Manual sync

`POST /api/v1/sync/accounts/{id}` (rate limited) marks the state `queued` and enqueues a run.
`GET /api/v1/sync/status` reports per-account status.

## Tuning

`SYNC_INTERVAL_SECONDS`, `SYNC_INITIAL_PAGE_SIZE`, `SYNC_PAGES_PER_RUN`,
`SYNC_BACKFILL_MAX_MESSAGES`, `SYNC_LOCK_TTL_SECONDS`, `PROVIDER_MAX_CONCURRENCY`,
`CELERY_CONCURRENCY`.
