# API

Base path: `/api/v1`. JSON unless stated. Interactive docs: `/api/docs` (disabled in production
unless `API_DOCS_ENABLED=true`).

## Conventions

- **Auth**: session cookie `mf_session` (HttpOnly). Unauthenticated → `401`.
- **CSRF**: every `POST/PUT/PATCH/DELETE` must send header `X-CSRF-Token` equal to the readable
  cookie `mf_csrf` (obtain with `GET /auth/csrf`). Missing/mismatch → `403 csrf_failed`.
- **Ownership**: a resource owned by another user is `404 not_found`.
- **Lists**: `{ "items": [...], "next_cursor": "opaque" | null }`; pass `?cursor=` and `?limit=`
  (default 30, max 100).
- **Timestamps**: ISO-8601 UTC.
- **Errors**:

  ```json
  { "error": { "code": "validation_error", "message": "Human readable", "details": [ { "field": "email", "code": "invalid" } ] } }
  ```

  Codes: `validation_error` 422, `unauthenticated` 401, `invalid_credentials` 401,
  `email_not_verified` 403, `csrf_failed` 403, `forbidden` 403, `not_found` 404, `conflict` 409,
  `rate_limited` 429 (with `Retry-After`), `provider_auth_required` 409,
  `provider_unavailable` 502, `provider_rate_limited` 503, `provider_not_configured` 503,
  `unsupported` 422, `payload_too_large` 413, `internal_error` 500.
  Additional specific codes: `invalid_token` 422 (verification / reset link invalid, used or
  expired), `send_in_progress` 409, `account_limit_reached` 409, `blocked_destination` 422.

## Health

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health/live` | process is up |
| GET | `/api/health/ready` | database and Redis reachable |

## Auth — `/auth`

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/auth/csrf` | — | `{csrf_token}` + sets `mf_csrf` |
| POST | `/auth/register` | `{email, password, display_name, locale?}` | `202 {status:"verification_required"}` (identical whether or not the address is already registered) |
| POST | `/auth/verify-email` | `{token}` | `200 {status:"verified"}` |
| POST | `/auth/resend-verification` | `{email}` | `202` |
| POST | `/auth/login` | `{email, password}` | `200 {user}` + session cookie |
| POST | `/auth/logout` | — | `204` |
| GET | `/auth/me` | — | `200 {user}` |
| POST | `/auth/password/forgot` | `{email}` | `202` |
| POST | `/auth/password/reset` | `{token, new_password}` | `200` (revokes all sessions) |
| POST | `/auth/password/change` | `{current_password, new_password}` | `204` (revokes other sessions) |
| GET | `/auth/sessions` | — | `{items:[Session]}` |
| DELETE | `/auth/sessions/{id}` | — | `204` |
| POST | `/auth/sessions/revoke-others` | — | `204` |
| GET | `/auth/providers` | — | `{google: bool}` — external sign-in methods configured here |
| GET | `/auth/oauth/google/start?locale=&next=` | — | `302` to Google (scopes `openid email profile`) + HttpOnly `mf_signin_state` cookie |
| GET | `/auth/oauth/google/callback` | `code`, `state` from Google | `302` to `/{locale}{next}` + session cookie, or to `/{locale}/login?oauth_error=<code>` |

`User`: `{id, email, display_name, email_verified, created_at}`.
`Session`: `{id, created_at, last_seen_at, expires_at, user_agent, ip_address, is_current}`.
Password policy: 10–128 characters.

Sign in with Google is MailFlow authentication only and grants no mailbox access (Gmail is
connected separately under `/accounts`). `next` must be a same-origin path, otherwise
`/mail/inbox`. `oauth_error`: `access_denied`, `email_not_verified`, `account_disabled`,
`invalid_state`, `not_configured`, `provider_error`.

## Users — `/users`

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/users/me` | — | `User` |
| PATCH | `/users/me` | `{display_name}` | `User` |
| POST | `/users/me/deactivate` | `{password}` | `204` (sessions revoked, sync stopped) |
| DELETE | `/users/me` | `{password, confirmation:"DELETE"}` | `204` |

## Settings — `/settings`

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/settings` | — | `Settings` |
| PATCH | `/settings` | partial `Settings` | `Settings` |

`Settings`: `{locale:"en"|"uk", theme:"system"|"light"|"dark", load_remote_images:boolean, conversation_view:boolean, list_density:"comfortable"|"compact", list_preview_lines:0|1|2, show_avatars:boolean, account_tint:"off"|"subtle"|"strong", accent_color:"blue"|"violet"|"green"|"orange"|"pink"|"graphite", reader_text_size:"small"|"default"|"large", undo_send_seconds:0|5|10|20|30}`. Any other value is a 422.
`undo_send_seconds` is the undo-send window (default 5, `0` = off); see Outbox.

## Accounts — `/accounts`

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/accounts/providers` | — | `{items:[{kind, available, capabilities}]}` — `kind` ∈ `gmail`, `outlook`, `imap`; `available` is true only when the provider is implemented **and** configured on this server (`imap` needs no configuration and is always available) |
| GET | `/accounts` | — | `{items:[Account]}` |
| POST | `/accounts/oauth/{provider}/start` | `{locale?}` | `{authorization_url}`. `provider` ∈ `gmail`, `outlook`; an unconfigured one answers 503 `provider_not_configured`, anything else 404 |
| GET | `/accounts/oauth/{provider}/callback` | query `code,state` / `error` | `302` → `/{locale}/settings/accounts?connected={id}` or `?error={code}` where code ∈ `invalid_state`, `access_denied`, `missing_code`, `authorization_failed`, `provider_unavailable`, `account_mismatch`, `account_limit_reached` |
| POST | `/accounts/{id}/reconnect` | `{locale?}` | `{authorization_url}`. OAuth mailboxes only; an IMAP mailbox answers 422 `unsupported` |
| POST | `/accounts/imap` | `ImapConnect` | `201 Account` (new) or `200 Account` (this address was already connected: credentials replaced). Both logins are tried first |
| POST | `/accounts/{id}/imap/credentials` | `{password}` | `200 Account`. New password for an IMAP mailbox; servers and user name stay as stored. 404 unless it is an IMAP mailbox of the caller |
| PATCH | `/accounts/{id}` | `{display_name?, color?}` | `Account`. `color` is any `#rrggbb` (case-insensitive, stored lower case); anything else is 422 |
| PUT | `/accounts/{id}/avatar` | multipart `file` | `Account`. PNG, JPEG or WebP, recognised from the bytes (the declared type is ignored), at most 128 KB (413 above, 422 for other types). 60/hour |
| DELETE | `/accounts/{id}/avatar` | — | `Account` without a picture |
| GET | `/accounts/{id}/avatar?v=…` | — | The picture with its recognised `Content-Type`, `nosniff`, a sandbox CSP and `Cache-Control: private, max-age=31536000, immutable` (`v` is the version from `avatar_updated_at`). 404 when there is none |
| DELETE | `/accounts/{id}` | — | `204` (credentials revoked and purged, mail data deleted) |

`Account`: `{id, provider, email_address, display_name, color, avatar_updated_at, status, status_reason, capabilities, created_at, sync:{status, last_synced_at, last_error_code}}`
where `status` ∈ `active | needs_reauth | error | disabled` and `sync.status` ∈
`idle | queued | running | error`.

`capabilities`: `{threads, labels, server_search, drafts, spam, archive, incremental_sync}` booleans,
**per account**: an IMAP mailbox reports `archive`, `spam` and `drafts` as true only when it has a
folder with that role (known after the first synchronization). An action whose capability is
false answers 422 `unsupported`.

`ImapConnect` (unknown fields are rejected):

```json
{
  "email_address": "me@example.com",
  "display_name": "Work",
  "imap": {"host": "imap.example.com", "port": 993, "security": "ssl"},
  "smtp": {"host": "smtp.example.com", "port": 587, "security": "starttls"},
  "username": "me@example.com",
  "password": "…"
}
```

`security` ∈ `ssl` (implicit TLS) | `starttls`; there is no plaintext option. `display_name` is
optional (1–100), `username` 1–255, `password` 1–1024, no control characters. Allowed ports: IMAP
143/993, SMTP 465/587.

Errors of both IMAP endpoints (all 422 unless noted). For the four mail-server codes `details`
is `[{"field": "imap" | "smtp", "code": <same code>}]`:

| Code | Meaning |
|---|---|
| `validation_error` | Malformed request; `details` lists fields such as `imap.host` |
| `blocked_destination` | Address is not a public host, or the port is not allowed for that protocol |
| `authentication_failed` | The server rejected the user name or password |
| `tls_required` | STARTTLS requested but not offered by the server |
| `connection_failed` | Everything else (unreachable, timeout, not a mail server, invalid certificate) |
| `account_limit_reached` (409) | The user already has 10 mailboxes |
| `credentials_missing` (409) | Reconnect only: nothing usable is stored; connect the mailbox again |
| `rate_limited` (429) | More than 10 attempts per hour (per user) or 20 (per IP); `Retry-After` |

The password is never returned by any endpoint, and server settings are not echoed.

## Sync — `/sync`

| Method | Path | Response |
|---|---|---|
| POST | `/sync/accounts/{id}` | `202 {status:"queued"}` |
| POST | `/sync/all` | `202 {queued: n}` |
| GET | `/sync/status` | `{items:[{account_id, status, last_synced_at, last_error_code, initial_sync_complete}]}` |

## Folders — `/folders`

| Method | Path | Response |
|---|---|---|
| GET | `/folders?account_id=` | `{items:[Folder]}` (all accounts when omitted) |
| GET | `/folders/counts?account_id=` | `{items:[{role, unread_count}]}` aggregated across accounts when omitted |

`Folder`: `{id, account_id, role, name, unread_count}`; `role` ∈
`inbox | starred | sent | drafts | archive | trash | spam | custom`.

## Threads — `/threads`

| Method | Path | Notes |
|---|---|---|
| GET | `/threads?view=&account_id=&folder_id=&unread=&cursor=&limit=` | `view` is a role (default `inbox`); `folder_id` selects a custom folder. Returns `ThreadSummary` list, newest first. |
| GET | `/threads/{id}` | `ThreadDetail` |
| POST | `/threads/{id}/actions` | `{action}` → `ThreadSummary` |
| POST | `/threads/actions` | `{thread_ids:[...max 100], action}` → `{updated:[id]}` |

`action` ∈ `mark_read | mark_unread | star | unstar | archive | unarchive | trash | restore | spam | not_spam`.

`ThreadSummary`: `{id, account_id, subject, snippet, participants:[Address], message_count, has_attachments, is_unread, is_starred, last_message_at}`.
`ThreadDetail`: `ThreadSummary` + `{messages:[Message]}` (oldest first).
`Address`: `{name: string|null, email: string}`.

## Emails — `/emails`

| Method | Path | Notes |
|---|---|---|
| GET | `/emails/{id}` | `Message` |
| POST | `/emails/{id}/actions` | `{action}` (`mark_read`, `mark_unread`, `star`, `unstar`) → `Message` |
| POST | `/emails/send` | `multipart/form-data`: field `payload` (JSON `SendRequest`) + repeated `files`. Header `Idempotency-Key` required. → `SendResponse`: `200` when sent now, `202` when held for the undo window or scheduled (see Outbox) |
| POST | `/emails/drafts` | `DraftRequest` → `201 Draft` |
| GET | `/emails/drafts/{id}` | `Draft` |
| PUT | `/emails/drafts/{id}` | `DraftRequest` → `Draft` |
| DELETE | `/emails/drafts/{id}` | `204` |

`Message`: `{id, thread_id, account_id, from:Address, to:[Address], cc:[Address], bcc:[Address], reply_to:[Address], subject, snippet, sent_at, is_read, is_starred, is_draft, body_html, body_text, has_remote_images, attachments:[Attachment]}`.
`body_html` is already sanitized server-side; the client still renders it in a sandboxed iframe.

`SendRequest`: `{account_id, to:[Address], cc:[Address], bcc:[Address], subject, body_html, mode:"new"|"reply"|"reply_all"|"forward", source_message_id?, draft_id?, forward_attachment_ids?:[id], send_at?}`.
`send_at` schedules the message; it must be in the future and at most a year ahead (`422` with
`{field:"send_at", code:"in_past"|"too_far"}`). It is either ISO-8601 with a UTC offset, or the
user's local wall-clock time without one (`2026-12-18T09:00:00`), which the server reads in the
IANA time zone of the `mf_tz` cookie and converts to UTC. Local time without a valid cookie is a
`422` with code `timezone_required`. The same applies to `PATCH /outbox/{id}`. Responses always
carry UTC.
`SendResponse`: `{status:"sent"|"undoable"|"scheduled", message_id, thread_id, outbox_id, send_at, undo_seconds}`.
`DraftRequest`: same fields without `forward_attachment_ids`; all recipients optional.
`Draft`: `{id, account_id, thread_id, to, cc, bcc, subject, body_html, mode, source_message_id, updated_at}`.

Limits: 25 MB total per message, 20 files.

## Outbox — `/outbox`

Send later and undo send share one server-side outbox (D42). `POST /emails/send` decides:

| Request | Result |
|---|---|
| `send_at` given | `202`, `status:"scheduled"`, `outbox_id`, `send_at` |
| no `send_at`, `undo_send_seconds` > 0 | `202`, `status:"undoable"`, `outbox_id`, `send_at` = now + window, `undo_seconds` |
| no `send_at`, `undo_send_seconds` = 0 | `200`, `status:"sent"`, `message_id`, `thread_id` |

The request is validated like a direct send before it is accepted (recipients, account, source
message, draft, attachment limits, hourly send limit). Repeating a request with the same
`Idempotency-Key` returns the first outcome and never queues or sends twice; after the item was
cancelled it is a `409 send_cancelled`, so a reopened composer must use a new key. At most 100
items may wait per user (`409 too_many_scheduled`).

| Method | Path | Notes |
|---|---|---|
| GET | `/outbox` | `{items:[OutboxItem]}` ascending by `send_at`: scheduled items waiting or being sent, every failed item, and undo-window items more than a minute overdue |
| GET | `/outbox/{id}` | `OutboxDetail` |
| PATCH | `/outbox/{id}` | `{send_at}` → `OutboxItem`. Pending or failed items only (a failed item is queued again); otherwise `409 outbox_not_editable` |
| POST | `/outbox/{id}/cancel` | → `OutboxDetail` with `status:"cancelled"` and the full content, so the composer can reopen it. Pending or failed items only; otherwise `409 outbox_not_cancellable` (too late: sending or sent) |

`OutboxItem`: `{id, account_id, status:"pending"|"sending"|"sent"|"cancelled"|"failed", send_at, created_at, subject, to, cc, bcc, snippet, attachment_count, mode, error_code}`.
`OutboxDetail`: `OutboxItem` + `{body_html, source_message_id, draft_id, forward_attachment_ids, attachments:[{filename, mime_type, size}]}`.
`error_code` of a failed item is the error code of the failed send (`provider_auth_required`,
`provider_unavailable`, `not_found`, …) or `outcome_unknown` when a worker died mid-send and the
message may or may not have gone out. Body and uploaded attachments are erased from the outbox
once an item is sent or cancelled. Another user's item is a `404`.

## Attachments — `/attachments`

| Method | Path | Notes |
|---|---|---|
| GET | `/attachments/{id}/download` | Streams bytes. `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`. |

`Attachment`: `{id, filename, mime_type, size, is_inline}`.

## Search — `/search`

| Method | Path | Notes |
|---|---|---|
| GET | `/search?q=&account_id=&cursor=&limit=` | `ThreadSummary` list from the user's synchronized mail |
