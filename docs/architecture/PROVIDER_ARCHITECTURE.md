# Email provider architecture

## Contract

`app/integrations/email_providers/contracts` defines everything business modules know about a
provider:

- `ProviderKind` — `gmail`, `outlook`, `imap`.
- `ProviderCapabilities` — explicit feature flags (threads, labels vs folders, server-side search,
  history-based sync, drafts, spam, OAuth vs password). The UI and use cases branch on these;
  providers are never assumed identical.
- `EmailProvider` (Protocol) — mailbox operations on an already-authenticated session:
  `list_messages`, `get_message`, `get_thread`, `send_message`, `reply_message`,
  `forward_message`, `modify_message`, `modify_thread`, `trash_thread`, `untrash_thread`,
  `delete_message`, `list_folders`, `search_messages`, `get_attachment`, `synchronize`,
  `create_draft`, `update_draft`, `delete_draft`.
- `OAuthClient` (Protocol) — `authorization_url`, `exchange_code` (authenticate),
  `refresh_credentials`, `revoke_credentials`, `fetch_identity`.
- Normalised DTOs — `ProviderMessage`, `ProviderThread`, `ProviderFolder`, `ProviderAttachment`,
  `OutgoingMessage`, `SyncChanges`, `Credentials` (OAuth tokens), `ServerCredentials`
  (password-based: IMAP and SMTP `MailEndpoint`s with a `MailSecurity`, user name, password),
  `Relocation` (a message whose id changed because an action moved it).
- Errors — `ProviderAuthError` (re-auth needed), `ProviderRateLimited(retry_after)`,
  `ProviderNotFound`, `ProviderCursorExpired`, `ProviderUnavailable`, `ProviderUnsupported`,
  `ProviderTlsRequired`, `ProviderDestinationBlocked`. `ProviderError.service` names the server
  (`imap` / `smtp`) for providers that have two.
- `ClosableProvider` (Protocol) — optional `aclose()` for adapters that hold a connection.

Adapters translate provider payloads into these DTOs. No Gmail/Graph/IMAP type crosses the
boundary.

## Registry

`ProviderRegistry` maps `ProviderKind` to a factory. It is built in the composition roots, so
business modules depend on the registry Protocol, not on adapters. `provider(kind, credentials)`
accepts either credential type; `oauth_client(kind)` exists for OAuth providers and
`verify_credentials(kind, ServerCredentials)` for password providers (log in to both servers and
log out). `capabilities(kind).oauth` tells the two families apart.

## Session lifecycle

`ProviderSessionFactory` (in `email_accounts.application`) turns an account into a ready adapter:

1. Load the account by `(account_id, user_id)`; require `status == active`.
2. Read credentials from the Token Vault: `oauth_tokens` for OAuth providers, the single
   `imap_password` secret (servers, user name, password) for password providers.
3. OAuth only: if the access token is near expiry, take a per-account Redis lock, refresh, store
   the new tokens, release. Password providers skip this step.
4. On `ProviderAuthError` (refused refresh, or a rejected IMAP/SMTP login) mark the account
   `needs_reauth` and stop.
5. Return the adapter bound to the credentials.
6. When the caller leaves the session, `aclose()` the adapter if it is a `ClosableProvider`
   (IMAP logs out and closes its connection).

Credentials exist in memory only for the duration of the call.

## Adapters

| Adapter | Status | Notes |
|---|---|---|
| `gmail` | Implemented | Gmail REST API over HTTPX, OAuth 2.0 + PKCE, history-based incremental sync |
| `outlook` | Implemented, **not verified live** | Microsoft Graph v1.0 over HTTPX, OAuth 2.0 + PKCE (Microsoft identity platform), per-folder delta sync behind one opaque cursor, immutable ids. Tested against a mocked Graph only |
| `imap` (IMAP + SMTP) | Implemented, **tested against a local test server only** | Standard library `imaplib` / `smtplib` in threads; password login; guarded transport (SSRF guard → validated IP → verified TLS); per-folder UID state behind one opaque cursor; ids are folder + UIDVALIDITY + UID |

See `docs/LIMITATIONS.md` for the authoritative status. Adding one:
`docs/development/ADDING_AN_EMAIL_PROVIDER.md`.

## Resilience

Adapters share an HTTP helper that applies timeouts, retries idempotent calls with exponential
backoff and jitter on 429/5xx, honours `Retry-After`, and converts exhausted retries into
`ProviderRateLimited` / `ProviderUnavailable` so Celery can reschedule the task. A call may name
statuses to be returned instead of raised (`passthrough`) when the adapter has to read the
provider's error code to classify the failure — the Outlook adapter uses it to tell an expired
delta token from any other rejected request.

## Cursors are opaque

`MessagePage.cursor`, `MessagePage.next_page_token` and `SyncChanges.cursor` are strings only the
adapter that issued them understands. Gmail stores a history id. Outlook has no mailbox-wide
change feed (delta queries are per folder), so its cursor is compact JSON holding one delta link
per folder plus resume state; a `synchronize` call does a bounded amount of work and returns a
cursor from which the next call continues. The sync runner never looks inside.

## Ids that change

Gmail and Outlook ids survive moves. An IMAP id does not: moving a message gives it a new UID in
another folder. `modify_thread` / `modify_message` therefore return `Relocation`s when they know
the new id, and `ThreadActionService` re-points the stored message, its conversation and its
attachments (`MessageIngestor.relocate`), so the row the client holds keeps working. Adapters
with stable ids return nothing.

## Per-account capabilities

`ProviderCapabilities` is per provider kind. For folder-based mailboxes the accounts API narrows
`archive`, `spam` and `drafts` to what the mailbox really has (a folder with that role); the
adapter raises `ProviderUnsupported` for the same cases, so the two cannot disagree for long.
