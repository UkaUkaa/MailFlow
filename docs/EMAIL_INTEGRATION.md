# Email integration

Architecture: `architecture/PROVIDER_ARCHITECTURE.md`. Status of each provider: `LIMITATIONS.md`.

## Gmail

Implemented with the Gmail REST API (`app/integrations/email_providers/gmail`).

| Capability | Implementation |
|---|---|
| Connect | OAuth 2.0 authorization code + PKCE, offline access |
| Read | `messages.list`, `messages.get (format=full)`, `threads.get`, `labels.list` |
| Incremental sync | `history.list` from the stored `historyId` |
| Actions | `threads.modify` / `messages.modify` (labels), `threads.trash` / `untrash` |
| Send / reply / forward | `messages.send` with RFC 5322 MIME built by the standard library |
| Drafts | `drafts.create / update / delete` |
| Attachments | `messages.attachments.get`, located by stable MIME part id |
| Resilience | timeouts, retry with exponential backoff + jitter on 429/5xx, `Retry-After`, bounded concurrency; sends are never retried after an ambiguous failure |

### Google Cloud setup

1. Create a project at <https://console.cloud.google.com/> and enable the **Gmail API**.
2. Configure the **OAuth consent screen** (External). Add the scope
   `https://www.googleapis.com/auth/gmail.modify`.
3. Create an **OAuth client ID** of type *Web application*.
   Authorized redirect URI: `{APP_BASE_URL}/api/v1/accounts/oauth/gmail/callback`
   (for the local stack: `http://localhost:8080/api/v1/accounts/oauth/gmail/callback`).
4. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and
   restart the backend and worker.

### Verification and production limits

- While the consent screen is in **Testing**, only listed test users can connect and refresh
  tokens expire after 7 days.
- `gmail.modify` is a **restricted scope**. Publishing to arbitrary Google users requires Google's
  OAuth verification, including a third-party security assessment (CASA), a privacy policy and a
  verified domain. Until that is complete, do not offer Gmail connection to the public.
- Gmail API quotas apply per project and per user; the adapter backs off on rate-limit responses
  and the sync scheduler applies exponential backoff per mailbox.

### Quota

Figures from Google's quota reference, confirmed against the live API in November 2026:

- 6,000 quota units per minute **per user**; 1,200,000 per minute per project.
- `messages.get` with `format=full` costs 60 units, so one mailbox can be read at **100 messages
  per minute at most**. `threads.modify` 10, `messages.send` 100, `messages.list` 5,
  `history.list` 2.

How MailFlow stays inside it:

- Workers pace every call by its unit cost against `GMAIL_SYNC_UNITS_PER_MINUTE` (default 3,600,
  i.e. about one full message per second). The remaining 2,400 units are left for the user's own
  actions and for other mail clients using the same mailbox.
- Pages are small (`SYNC_INITIAL_PAGE_SIZE=25`, four per run) and each page is committed, so a
  rate limit never throws away more than one page of work.
- API requests made for a person are not paced and retry once, so the UI answers quickly.
- A rate-limited sync is retried after `SYNC_RATE_LIMIT_BACKOFF_SECONDS` (90) without escalating.

Consequence: the first import of a large mailbox takes time — roughly 50–60 messages per minute,
newest first, up to `SYNC_BACKFILL_MAX_MESSAGES`.

### Token handling

Tokens are stored only in the Token Vault (see `SECURITY.md`). Access tokens are refreshed shortly
before expiry under a per-account lock; whatever the refresh returns — including a rotated
refresh token — replaces the stored credentials. `invalid_grant` marks the account `needs_reauth`; the user
reconnects from Settings → Accounts, which must return the same mailbox.

## Outlook (Microsoft Graph)

Implemented with Microsoft Graph v1.0 (`app/integrations/email_providers/outlook`) for Outlook.com
and Microsoft 365 mailboxes.

> **Status: tested against a mocked Graph only.** No Microsoft account or app registration was
> available while this was written, so nothing here has run against the live service. Every
> Graph fact below was read from Microsoft's documentation on 2026-11-17 and is linked; treat the
> first live connection as a verification pass (see `LIMITATIONS.md`).

| Capability | Implementation |
|---|---|
| Connect | OAuth 2.0 authorization code + PKCE on the Microsoft identity platform v2.0, `offline_access` |
| Identity | `GET /me?$select=id,mail,userPrincipalName` (`mail`, else `userPrincipalName`) |
| Read | `GET /me/messages` (whole mailbox, newest first), `GET /me/messages/{id}`, conversation by `$filter=conversationId eq '…'`, folders by walking `/me/mailFolders` and `childFolders` |
| Ids | `Prefer: IdType="ImmutableId"` on every request, so an id survives moves between folders |
| Incremental sync | `GET /me/mailFolders/{id}/messages/delta` per folder, all folders behind one opaque cursor |
| Roles | From the parent folder (`inbox`, `sentitems`, `drafts`, `deleteditems`, `junkemail`, `archive`); star = `flag.flagStatus == "flagged"` |
| Actions | Read/unread and star by `PATCH`; archive, trash, spam and their reverses by `POST …/move` to a well-known folder, applied to each message of the conversation |
| Send / reply / forward | Create a draft (`POST /me/messages`, or `POST …/createReply` on the original for replies), then `POST …/send` |
| Drafts | A draft is a message: `POST /me/messages`, `PATCH`, `DELETE` |
| Attachments | Metadata from `…/attachments?$select=…` (no content), bytes from `…/attachments/{id}/$value`; upload inline under 3 MB, otherwise an upload session |
| Resilience | Same helper as Gmail: timeouts, backoff with jitter on 429/5xx, `Retry-After`; create and send calls are never retried after an ambiguous failure |

### Microsoft Entra setup

1. Open <https://entra.microsoft.com/> → **Applications → App registrations → New registration**.
2. **Supported account types**: *Accounts in any organizational directory and personal Microsoft
   accounts* (`signInAudience: AzureADandPersonalMicrosoftAccount`). This is what the `common`
   endpoint needs to accept both work/school and Outlook.com accounts. To restrict sign-in, pick a
   narrower type and set `MICROSOFT_TENANT` to `organizations`, `consumers` or your tenant id.
3. **Redirect URI**: platform **Web**, value
   `{APP_BASE_URL}/api/v1/accounts/oauth/outlook/callback`
   (local stack: `http://localhost:8080/api/v1/accounts/oauth/outlook/callback`). It must match
   exactly. Do not register it as a single-page application: refresh tokens for SPA redirect URIs
   expire after 24 hours.
4. **Certificates & secrets → New client secret**. Copy the secret *value* (not its id). Secrets
   expire — note the date; an expired secret stops every refresh until it is replaced.
5. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**:
   `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`. None of them needs admin consent.
6. Put the application (client) id and the secret in `.env` as `MICROSOFT_CLIENT_ID` /
   `MICROSOFT_CLIENT_SECRET` (and `MICROSOFT_TENANT` if not `common`), then restart the backend and
   the worker.

### Scopes

| Scope | Why |
|---|---|
| `Mail.ReadWrite` | Read, flag, move, drafts and attachments (least privilege for move and update) |
| `Mail.Send` | Send a draft |
| `User.Read` | `GET /me` for the mailbox address |
| `offline_access` | Refresh token, required for background synchronization |

Not requested: `Mail.ReadWrite.Shared`, calendar, contacts, or any application permission.
Source: <https://learn.microsoft.com/en-us/graph/permissions-reference>.

### Verification and production limits

- Microsoft has no equivalent of Google's restricted-scope security assessment for these
  permissions, but an **unverified multitenant app** is limited: where an organization uses
  risk-based step-up consent, its users cannot consent to a new multitenant app that is not
  publisher verified and an administrator has to approve it; elsewhere users see an "unverified"
  warning. Tenant administrators can also disable user consent entirely.
  <https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview>
- Publisher verification is free but needs a verified Microsoft AI Cloud Partner Program account,
  and an app registered with a personal Microsoft account cannot be verified. Register the
  production app in an organizational tenant.
- Refresh tokens last 90 days by default and are replaced on every use; MailFlow stores the new
  one each time. A mailbox that is not synchronized for that long has to be reconnected.
  <https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens>
- The Microsoft identity platform has **no token revocation endpoint**. Disconnecting deletes
  MailFlow's stored tokens; the grant stays listed among the apps of the user's Microsoft
  account until they remove it there.
  <https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc>

### Throttling

From <https://learn.microsoft.com/en-us/graph/throttling-limits> ("Outlook service limits"), per
application and mailbox:

- 10,000 API requests in a 10-minute period,
- four concurrent requests,
- 150 MB of uploads (PATCH, POST, PUT) in a 5-minute period.

Throttled calls answer `429` with a `Retry-After` header
(<https://learn.microsoft.com/en-us/graph/throttling>).

How MailFlow stays inside it:

- Workers pace every request against `OUTLOOK_SYNC_REQUESTS_PER_MINUTE` (default 300, i.e. 30% of
  the average allowance) and use at most two of the four concurrent requests; the rest is left
  for the user's own actions and for other clients of the same registration.
- Requests made for a person are not paced, use up to four connections and retry once.
- One `synchronize` call makes at most 100 delta requests and 300 existence checks; anything left
  continues on the next run from the cursor.
- A rate-limited sync is retried after `SYNC_RATE_LIMIT_BACKOFF_SECONDS`, as for Gmail.

### Synchronization

Graph has no mailbox-wide change feed: delta queries are per folder
(<https://learn.microsoft.com/en-us/graph/delta-query-messages>). The provider contract is
mailbox-wide, so the adapter keeps the per-folder state inside the opaque cursor.

1. **Backfill** pages through `GET /me/messages` (all folders, `$orderby=receivedDateTime desc`),
   following `@odata.nextLink`. The first page returns a cursor that records only the time.
2. The first `synchronize` **primes** each folder: it walks the folder's initial delta round with
   `$select=lastModifiedDateTime` to obtain a delta link, and reports just the messages modified
   since the cursor was created (minus five minutes of clock tolerance). `$deltatoken=latest` is
   not documented for messages, so the round cannot be skipped.
3. Later calls request each folder's delta link. New and changed messages are reported as
   upserts. `@removed` means "no longer in this folder" — a move as much as a deletion — so each
   removed id is checked with `GET /me/messages/{id}?$select=id` and reported as deleted only when
   the mailbox no longer has it.
4. An expired token (`410 Gone`, or a 4xx with `syncStateNotFound`), a folder that answers 404, or
   a tracked folder that disappeared raises `ProviderCursorExpired`; the runner then rebuilds the
   mailbox's local copy. Microsoft gives no fixed lifetime for Outlook delta tokens.
   <https://learn.microsoft.com/en-us/graph/delta-query-overview>

### Sending

- `POST /me/messages` creates the draft, attachments are added, `POST /me/messages/{id}/send`
  sends it (202, no body) and saves it to Sent Items. With immutable ids the sent copy keeps the
  draft's id, which is how MailFlow finds it afterwards
  (<https://learn.microsoft.com/en-us/graph/outlook-immutable-id>). The copy may not be readable
  for a moment after sending; the next synchronization picks it up.
- Graph does not let a JSON message set `In-Reply-To` / `References` (only custom `x-` headers), so
  a reply is started with `createReply` on the original — found by its `internetMessageId` — and
  then given MailFlow's subject, body and recipients. If the original is no longer in the mailbox
  the reply is sent as a new conversation.
- A failure before the send call deletes the half-built draft. A network failure *during* the
  send call is never retried and leaves the draft alone, because the message may already be out.
- Attachments under 3 MB are posted directly; larger ones (up to 150 MB) go through an upload
  session in 3 MB ranges, sent without the access token as Microsoft requires. Exchange Online's
  default message size limit is 35 MB.
  <https://learn.microsoft.com/en-us/graph/outlook-large-attachments>

## IMAP / SMTP (any other mailbox)

Implemented in `app/integrations/email_providers/imap` with the Python standard library
(`imaplib`, `smtplib`, `email`) running in worker threads. It is the only password-based
provider and the only one whose server addresses come from users.

> **Status: tested against a local test server only** (GreenMail 2.1.3 from
> `docker-compose.dev.yml`) and against in-process scripted servers. It has **not** been run
> against Gmail, Yahoo, iCloud, Fastmail, Dovecot, Exchange or any other real-world server. Treat
> the first real mailbox as a verification pass (see `LIMITATIONS.md`).

### Connecting

Settings → Connected accounts → **Connect another mail account (IMAP)**. The form asks for:

| Field | Notes |
|---|---|
| Email address | The address mail is sent from |
| Display name | Optional |
| IMAP server, port, encryption | `993` + SSL/TLS (default) or `143` + STARTTLS |
| SMTP server, port, encryption | `587` + STARTTLS (default) or `465` + SSL/TLS |
| User name | Usually the full email address |
| Password | See "App passwords" below |

MailFlow logs in to both servers before it stores anything. If either login fails, nothing is
saved. The answer is one of four codes, with the server (`imap` or `smtp`) it concerns:

| Code | Meaning |
|---|---|
| `blocked_destination` | The address is not a public internet host, or the port is not a mail port |
| `authentication_failed` | The server rejected the user name or password |
| `tls_required` | STARTTLS was chosen but the server does not offer it |
| `connection_failed` | Anything else: unreachable, timeout, wrong protocol, invalid certificate |

Connecting is limited to 10 attempts per hour per user (20 per IP address).

### App passwords

Many providers refuse the normal account password for IMAP/SMTP once two-step verification is
on, or always. Create an *app password* (a separate password for one application) in the
provider's account security settings and enter that one. Known to require it at the time of
writing: Gmail / Google Workspace, Yahoo Mail, iCloud Mail, Fastmail, Zoho (with 2FA). Gmail and
Outlook.com mailboxes are better connected with their own buttons (OAuth) — Microsoft has
disabled password logins for Outlook.com IMAP/SMTP, so those cannot be connected this way at
all. Provider policies change; when a correct password is rejected, look for "app password" in
the provider's help.

A password that later stops working (changed or revoked at the provider) puts the mailbox in
*Reconnect required*; **Reconnect** asks for the new password only.

### What is supported

| Capability | Implementation |
|---|---|
| Transport | TLS always: implicit (993 / 465) or STARTTLS (143 / 587) with full certificate and host name verification, TLS 1.2+. Plaintext is never used; a server without STARTTLS is refused before any credential is sent |
| Login | IMAP `AUTHENTICATE PLAIN` when offered, else `LOGIN`; SMTP `AUTH` (PLAIN / LOGIN / CRAM-MD5 as offered) |
| Folders | `LIST "" "*"`; roles from RFC 6154 SPECIAL-USE attributes (`\Sent`, `\Drafts`, `\Trash`, `\Junk`, `\Archive`), else from common English names (`Sent`, `Sent Items`, `Drafts`, `Trash`, `Deleted Items`, `Junk`, `Spam`, `Archive`, …). `\All`, `\Flagged` and `\Noselect` folders are skipped |
| Message identity | `<folder key>.<UIDVALIDITY>.<UID>`; the folder key is the folder's wire name (base64url) or a SHA-256 prefix for names over 150 characters |
| Initial import | Folder by folder (Inbox first), newest UID first, `BODY.PEEK[]` so nothing is marked as read |
| Incremental sync | Per folder: new UIDs, expunged UIDs (UID-set comparison), flag changes — with CONDSTORE (`CHANGEDSINCE`) when offered, otherwise by re-reading the flags of the 100 most recent messages. At most 200 new/changed messages per run; the cursor resumes |
| UIDVALIDITY change, folder removed | `ProviderCursorExpired` → the mailbox's local copy is rebuilt |
| Read / unread, star | `UID STORE` on `\Seen` / `\Flagged` |
| Archive, trash, spam and their reverses | `UID MOVE` (RFC 6851), else `UID COPY` + `\Deleted` + `UID EXPUNGE` (RFC 4315). Reverses move to the Inbox |
| Send / reply / forward | SMTP submission, then the copy is appended to the Sent folder (`\Seen`) |
| Drafts | `APPEND` to the Drafts folder with `\Draft`; an edit appends the new version and then removes the old one |
| Attachments | Parsed from the message's MIME structure; addressed by IMAP-style part number (`2`, `1.2`); bytes are fetched on demand |
| Bodies | Parsed with `email` (policy `default`), 2 MB per body, 40 MB per message read; sanitized by the same ingestion step as every other provider |

### What is not supported

- **Conversations.** `capabilities.threads` is false: every message is its own conversation.
  Grouping by `References` would need the whole mailbox's headers and is not done.
- **Server-side search** (`server_search` is false). Search covers mail already synchronized.
- **Archive, spam, drafts without a folder for them.** The account's `capabilities` report
  `archive` / `spam` / `drafts` as false when the mailbox has no such folder, the interface hides
  the action, and the API answers `422 unsupported`. MailFlow does not create folders.
- **Moves on servers with neither MOVE nor UIDPLUS** → `unsupported` (a plain `EXPUNGE` would
  also destroy other messages the user marked as deleted elsewhere).
- **Permanent deletion**, **sending a stored draft from the server** (`send_draft`), OAuth2 /
  XOAUTH2 logins, client certificates, IMAP IDLE / push, shared namespaces, folder creation.
- **Changing servers or user name of a connected mailbox**: disconnect and connect again.
- **Non-English folder names** on servers without SPECIAL-USE are treated as ordinary folders.

### Synchronization details

IMAP has no mailbox-wide change feed, so the opaque cursor holds, per folder: UIDVALIDITY, the
highest UID reported, HIGHESTMODSEQ (with CONDSTORE), the set of UIDs known to exist (stored as
ranges, e.g. `1:4812`) and the flags of the recent window. One `synchronize` call:

1. `LIST`, then `STATUS` for every folder (no `SELECT` when nothing changed and CONDSTORE is
   available).
2. `UIDNEXT` moved → `UID SEARCH UID <last+1>:*` → new messages.
3. `MESSAGES` differs from the known count → `UID SEARCH ALL` → expunged UIDs.
4. Flags: `UID FETCH 1:<last> (UID FLAGS) (CHANGEDSINCE <modseq>)`, or the recent window.
5. A folder whose UIDVALIDITY changed, or a tracked folder that no longer exists, expires the
   cursor (RFC 3501 §2.3.1.1: the stored UIDs mean nothing any more).

A message moved by MailFlow itself keeps its row: the server's `COPYUID` answer gives the new
id, which replaces the old one locally (message, conversation and attachments), so "undo" works
immediately. Without UIDPLUS the next synchronization removes the old id and adds the new one.

### Sending details

- The message is built with `email.message.EmailMessage`; every header value is reduced to one
  line and addresses used in `MAIL FROM` / `RCPT TO` must be plain `local@domain`, so user input
  cannot add headers or SMTP commands.
- `Bcc` recipients are in the envelope and in the saved copy, never in the transmitted headers.
- A submission is never retried: after `DATA` a failure is ambiguous.
- If the copy cannot be saved (no Sent folder, `APPEND` refused) the send still succeeds; the
  message is simply not listed under Sent.
- Some servers (Gmail) save submitted mail to Sent themselves; there the appended copy is a
  duplicate. Not handled.

### Operations

- No configuration is needed to enable it. Optional: `MAIL_CONNECT_TIMEOUT_SECONDS` (10),
  `MAIL_IO_TIMEOUT_SECONDS` (30).
- The backend and worker containers need outbound TCP 993, 143, 465 and 587.
- Every operation opens its own IMAP connection (connect, TLS, login) and closes it; there is no
  connection pool.

## Adding a provider

See `development/ADDING_AN_EMAIL_PROVIDER.md`.
