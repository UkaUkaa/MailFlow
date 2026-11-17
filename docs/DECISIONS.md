# Architectural decisions

Short ADR log. Newest last. `docs/architecture/DECISIONS.md` points here.

## D1 — Modular monolith with clean-architecture modules
One deployable backend; modules communicate through application-layer ports. Extraction to
services stays possible without paying the operational cost now.

## D2 — Opaque server-side sessions, not JWT
A 256-bit random token is set in an HttpOnly cookie; only its SHA-256 hash is stored in
`user_sessions`. Gives instant revocation, session listing and no token material in JavaScript.

## D3 — CSRF: double-submit cookie + Origin check
Cookie auth requires CSRF defence. `mf_csrf` (readable) must be echoed in `X-CSRF-Token`; the
middleware also rejects state-changing requests whose `Origin` is not allowlisted.
`SameSite=Lax` on the session cookie is a third layer.

## D4 — Tenant isolation: application checks + PostgreSQL RLS
Repositories always filter by `user_id` (authoritative). RLS with a transaction-local setting is
defense in depth; the app role is not the table owner. See `architecture/DATA_OWNERSHIP.md`.

## D5 — Token Vault: AES-256-GCM with a versioned keyring
`cryptography`'s AESGCM, random 96-bit nonce per record, AAD = `user_id|account_id|kind` so a
ciphertext cannot be replayed onto another account. Keys come from `VAULT_KEYS` (`id:base64`
pairs) with `VAULT_PRIMARY_KEY_ID`; rotation = add key, switch primary, run `rotate` command.
A KMS-backed envelope scheme is the production upgrade path (same port).

## D6 — Gmail through the REST API with HTTPX, no Google SDK
Keeps the adapter async, small, and testable with `respx`. Scope: `gmail.modify` (read, label,
trash, send, drafts — no permanent delete) plus `openid email` to identify the mailbox.

## D7 — Message bodies are stored (sanitized), attachments are not
Sync stores headers, snippet and sanitized body so reading and search are instant and work while
the provider is slow. Attachment bytes are never stored; downloads stream from the provider
through an authorized endpoint. Everything is deleted on disconnect / account deletion.

## D8 — Threads are the list unit
The list shows conversations (provider thread semantics). Providers without threads will map each
message to a single-message thread.

## D9 — Drafts live at the provider
Drafts are created/updated through the provider's drafts API so they are visible in other clients.
Draft attachments are kept client-side until send (limitation).

## D10 — Email HTML: server sanitization (nh3) + sandboxed iframe + CSP
Two independent layers. Remote images are blocked by CSP inside the frame unless the user opts in
per message or globally. There is no image proxy (avoids an SSRF surface).

## D11 — Celery tasks run async use cases via `asyncio.run`
Workers use a `NullPool` engine per task run so no connection crosses event loops.

## D12 — Same-origin deployment
Nginx serves frontend and `/api` on one origin; in development Next.js rewrites `/api` to the
backend. No CORS in the normal path; an allowlist exists for explicit exceptions.

## D13 — Email verification is required before login
Configurable with `REQUIRE_EMAIL_VERIFICATION` (default `true`). Development uses Mailpit.

## D14 — Rich text editor: Tiptap
Maintained, headless, accessible, small enough to lazy-load with the composer.

## D15 — Layer-as-file for small modules
Modules keep `domain` / `application` / `infrastructure` / `presentation` in the import path;
small ones use single files instead of packages.

## D16 — One composition root (`app/bootstrap.py`)
`Runtime` holds process singletons; `Services` builds use cases for one database session. The API
and the Celery workers share it, so wiring cannot drift between them.

## D17 — RLS without `FORCE`
The application role is not the table owner, so policies always apply to it. `FORCE ROW LEVEL
SECURITY` is not set because the owner must run the `SECURITY DEFINER` scheduler/cleanup functions
and cascading deletes.

## D18 — Scheduling by lease in the database
`mailflow_claim_due_syncs` hands out due mailboxes and pushes `next_sync_at` forward as a lease.
No Celery retries or ETA chains are needed; a crashed run is simply reclaimed when its lease ends.

## D19 — Next.js 16 with `cacheComponents` / `partialPrefetching` disabled
Both are on by default in the Next 16 scaffold and are turned off to keep next-intl's
request-scoped locale handling simple. Revisit when the app has cacheable server-rendered content.

## D20 — Application CSP is set at Nginx
`script-src`/`style-src` allow `'unsafe-inline'` (current Next.js output needs it) and `img-src`
allows `https:` because sandboxed email frames inherit the page policy; each frame narrows it with
its own CSP. A nonce-based policy is planned hardening.

## D21 — Frontend route notes
Search is a mail view (`/mail/search?q=`), and the signed-in frame is composed in
`src/app/[locale]/(application)/_shell/`. `BACKEND_INTERNAL_URL` is a build-time argument of the
frontend image (default `http://backend:8000`); in the Docker stack Nginx routes `/api` directly.

## D22 — IMAP/SMTP on the standard library, in threads
`imaplib`, `smtplib` and `email` run through `asyncio.to_thread`; no new dependency. The async
alternatives (`aioimaplib`, the already present `aiosmtplib`) do not let the caller choose the
socket, and the whole point of the transport is to dial an IP address that the SSRF guard has
validated while verifying TLS against the host name. Overriding `_create_socket` / `_get_socket`
of the stdlib classes does exactly that in a few lines. Cost: one thread per in-flight call.

## D23 — One vault secret per password mailbox, hosts included
`imap_password` holds IMAP host/port/security, SMTP host/port/security, user name and password as
one AES-GCM ciphertext bound to user and account. No migration, no plain column naming a user's
mail server, and credentials and the servers they belong to cannot drift apart. `smtp_password`
stays in the enum unused. Consequence: server settings cannot be shown or edited without
decrypting; changing them means reconnecting.

## D24 — IMAP message id = folder key + UIDVALIDITY + UID; moves re-point the row
IMAP has no mailbox-wide stable id (OBJECTID, RFC 8474, is rare). The id is exactly the triple
that IMAP guarantees. Because a move changes it, `modify_thread` / `modify_message` may return
`Relocation`s (contract change; Gmail and Outlook return nothing) and the stored message,
conversation and attachments are re-pointed. The alternative — let the next synchronization
delete and re-create the message — breaks "undo" and changes the ids the client holds.

## D25 — IMAP cursor carries the known UID set
Expunges are found by comparing UID sets, so the cursor stores every known UID per folder as
ranges (`1:4812,4815:5000`), which stays small for real mailboxes. QRESYNC would make this
unnecessary but is less widely available than CONDSTORE and could not be tested here. Flag changes
use CONDSTORE when offered, else a 100-message window whose flags are also kept in the cursor.

## D26 — No conversations for IMAP
`threads=False`; one message per conversation. Grouping by `References` / `In-Reply-To` needs
every message's headers before the first page can be shown and a re-grouping pass whenever an
older message arrives; server `THREAD` is optional and per folder. Not worth a half-working
version.

## D27 — Capabilities are narrowed per account in the API
The contract's capabilities are per provider kind and synchronous. Whether an IMAP mailbox can
archive depends on its folders, so the accounts endpoint intersects `archive` / `spam` / `drafts`
with the roles of the mailbox's synchronized folders, and the adapter raises
`ProviderUnsupported` for the same cases. MailFlow never creates folders in a user's mailbox.

## D28 — Test-only transport switches instead of an "insecure" mode
The local test server lives on loopback with a private certificate. Rather than a flag that
turns verification off, there are two widening switches — `SSRF_ALLOW_PRIVATE_NETWORKS`
(loopback and any port) and `MAIL_TLS_CA_FILE` (one extra trust anchor) — both rejected by
`Settings` outside `ENVIRONMENT=test`. Production code has no branch that skips TLS or
certificate verification, and the integration tests exercise real verification.

## D29 — Connect errors: four codes, HTTP 422
`blocked_destination`, `authentication_failed`, `tls_required`, `connection_failed`, all 422 (the
submitted settings do not work), never 401 (which clients treat as "signed out") or 502. The
failing side (`imap` / `smtp`) is named: it adds nothing an attacker could not get by submitting
one host at a time, and users need it.

## D30 — A new IMAP connection per operation
The provider session (`ProviderSessionFactory.open`) is per use case, so the adapter connects
lazily and is closed when the session ends. Pooling connections across requests and workers
would need per-account connection ownership and idle handling; deferred until latency against
real servers shows it is needed.
