# synchronization module

Background synchronization of mailboxes: request, status, and the worker-side `SyncRunner`.

| Layer | Contents |
|---|---|
| domain | `SyncState`, `SyncStatus` |
| application | `SyncRequestService`, `SyncRunner`, unit-of-work and queue ports |
| infrastructure | `sync_states` table, repository |
| presentation | `/sync` router |

**Depends on:** `email_accounts`, `emails`, `folders`, provider contract

**Tenant data:** `sync_states` (RLS). See `docs/EMAIL_SYNC.md`.
