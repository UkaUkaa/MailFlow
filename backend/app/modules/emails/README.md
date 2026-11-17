# emails module

Messages and conversations: ingestion (the single sanitizing entry point), thread lists, detail, actions, composing, drafts.

| Layer | Contents |
|---|---|
| domain | flags, `apply_action`, `compute_thread_state`, entities |
| application | `MessageIngestor`, `ThreadQueryService`, `ThreadActionService`, `ComposeService`, ports |
| infrastructure | `email_threads`, `email_messages` tables, repository, HTML sanitizer adapter |
| presentation | `/threads` and `/emails` routers |

**Depends on:** `email_accounts`, `folders`, `attachments`, provider contract

**Tenant data:** `email_threads`, `email_messages` (RLS). Only sanitized HTML is stored.
