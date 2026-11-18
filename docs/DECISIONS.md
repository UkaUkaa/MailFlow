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

## D31 — Adopt the reference client's layout, not its identity
The frontend follows `docs/design/SPARK_REFERENCE.md` for layout, structure, density, states and
behaviour: icon rail that expands in place, date-grouped three-line list with avatars and
gutter quick actions, messages as cards, document-like composer and docked reply, search as a
mode of the list, settings as a dialog. Name, logo, glyphs, illustrations and colour values are
not taken: the palette stays MailFlow's (ink-blue accent, own neutrals), icons are Lucide, the
empty pane uses an open-envelope glyph. Deliberately **not** carried over, because MailFlow has
no such feature and a control must do something real: pin, snooze, assign, share, AI, calendar,
priority toggle, smart category cards, agents entry, templates, reminders, send later,
send-and-archive, pop-out window, view switcher and sort mode in the list header.

## D32 — Three tonal surfaces, also in the light theme
Panes are separated by tone (`--rail` → `--background` → `--surface`), without divider lines.
The dark theme was observable; the light theme was derived from the same roles (most tinted
rail, faint grey reading pane, white list and cards). The neutrals were re-tuned for this and
re-measured for WCAG AA (table in `DESIGN_SYSTEM.md`); `--warning`, `--success` and `--danger`
were darkened in light because they no longer reached 4.5:1 on the grey canvas.

## D33 — Settings dialog: a layout over the workspace, not intercepting routes
From 768px the settings routes render as a modal dialog. Next's intercepting routes show a modal
only after a soft navigation; a reload, a deep link or the OAuth return would have rendered the
plain page instead, giving two presentations of one URL. The settings layout therefore always
renders the mail workspace (inert) behind the dialog, and the URL stays the single source of
truth. The dialog's geometry is CSS (no hydration flash); role, Escape, focus containment and
`inert` are switched on in script. Radix `Dialog` is not used for this frame because switching
between its modal and non-modal content remounts the children, which would run the OAuth-result
effect twice.

## D34 — Where the reference was not followed
- **No hover flyout**: the navigation expands in place instead (D35).
- **Formatting bar is always visible** in the composer — a selection-only toolbar is unreachable
  on touch.
- **Send is a labelled primary button**, close is an X button, the settings dialog closes with an
  X (not a red dot imitating window chrome).
- **Star stays in the list row**; the list header keeps the unread filter and sync.
- **Reading column is capped** at `52rem` and centred (the reference has no cap at its window
  size); the toolbar and subject share the column so they stay aligned on wide screens.
- **Search suggestions are recent queries and a description**, not operators: the API is a plain
  full-text prefix search. Recent queries stay in memory, never in `localStorage`.
- **The "done" segment is labelled Archive** and exists only where the mailbox can archive.
- **Recipients open on first focus and stay open** — collapsing them again on blur would move
  the page under the pointer between mouse-down and mouse-up.
- **Month headings** use the locale's standalone month name; week boundaries follow the locale
  (Sunday in en-US, Monday in uk).

## D35 — One navigation layout; the flyout is removed
The rail and the open menu were two component trees, so opening the menu moved every icon,
turned Compose into a wide button and reflowed the language and theme controls. They are now one
column of rows (fixed icon cell + label) that only changes width; nothing else moves, which is
asserted per icon in `e2e/layout.spec.ts`. Consequences:
- The overlay flyout ("Accounts and folders") is gone. Its only content the rail lacked was the
  account switcher and the mailbox's folders. Accounts are now rows of the column in both states
  (colour dot as the icon); the folders are shown when expanded, because a column of identical
  folder icons says nothing.
- Compose is an ordinary row (no accent button) and the segmented language / theme switches left
  the navigation (they remain in Settings → Appearance and on the sign-in pages), so the top and
  bottom blocks have the same rows in both states. The phone drawer uses the same rows.
- The column keeps the `--rail` surface when expanded: changing the surface would read as a
  different panel.
- The state lives on `<html data-nav>`, set by an inline script before first paint, instead of
  being derived from React state after hydration, which showed the rail for a few frames.
- `--nav-width` is a registered custom property transitioned on `:root`, so the column, the
  panes and the composer cannot get out of step; browsers without `@property` switch instantly.
- The language and theme rows keep their accessible names ("Switch language to …") while the
  visible label names the current value ("Language: English"), as required for a stable name in
  both states. This does not satisfy WCAG 2.5.3 (label in name) literally; see LIMITATIONS.

## D36 — Any account colour, an optional picture, and a colour wash on message rows
Users pick any RGB colour for a mailbox and may add a small picture; every row of the thread list
is tinted with the mailbox colour.
- **Colours are stored as `#rrggbb`.** The API used to accept only eight names (`blue`, …) while
  the UI sent hex values, so saving a colour failed with 422. Migration 0002 maps the names to the
  hex values the UI already showed and adds a check constraint.
- **The picture lives in `email_accounts`** (a deferred `bytea` column) rather than a new table:
  it is one small value per account, is deleted with the account, and needs no extra RLS policy.
  It is never loaded with the account list; `avatar_updated_at` versions its URL so it can be
  cached as immutable.
- **No image library on the server.** The browser crops and re-encodes; the server enforces size
  and recognises PNG / JPEG / WebP from the bytes, and serves with `nosniff` and a sandbox CSP.
  Decoding untrusted images on the server would add attack surface for no gain in this use.
- **The wash is a small share of the colour mixed into the surface** (OKLab `color-mix`), not
  an opacity overlay, so text keeps its colour and contrast is predictable; the shares are theme
  tokens. The selected row keeps the accent fill so the open conversation stays obvious.

## D37 — Interface preferences on the account, applied as `<html>` attributes
Settings → Interface lets users choose list density, preview lines, sender pictures, wash
strength, an accent colour and the reader's text size.
- **Stored server-side with the other settings**, not only in the browser, so they follow the
  user to every device. They are also cached in `localStorage` (nothing sensitive) only to avoid
  a flash of the default layout on reload, the same way the theme is.
- **Applied as data attributes and CSS variants**, not React props: the thread row, its skeleton
  and the preview in settings share one set of classes, and nothing between the settings query
  and the row needs to know about them.
- **Fixed choices, not free values.** Accents are six reviewed palettes rather than any colour,
  so contrast can be guaranteed and tested; free-form colour stays with mailboxes (D36).
- **Reader text size sets only the base size.** Most HTML email sets its own sizes and is shown
  as authored; scaling it would fight the fit-to-width logic of the email frame.

## D38 — Sign in with Google: OIDC in the authentication module, linked by subject
- **Separate from Gmail access.** Sign-in asks only for `openid email profile` and stores no
  Google token; connecting Gmail remains its own consent in `email_accounts`. A user can sign
  in with one Google account and connect a different mailbox, and revoking one does not touch
  the other. The same OAuth client is reused, with its own redirect URI.
- **Identities are keyed by Google's `sub`**, not by e-mail address, in `user_identities`.
  Like `user_sessions` it is read before anyone is authenticated, so it is not under tenant RLS;
  it is only ever queried by `(provider, subject)` taken from a validated exchange.
- **Automatic linking by verified e-mail.** If no identity matches, an account with the same
  address is linked, but only when Google says the address is verified. If that account never
  verified its address, its password is replaced with an unusable one and its sessions are
  revoked, so a pre-registered password cannot outlive the real owner's sign-in. New accounts get
  an unusable random Argon2id password; "forgot password" sets a real one.
- **State in Redis plus a browser-bound cookie.** The state (with PKCE verifier and nonce) is
  single-use with a 10-minute TTL; the callback also requires the same value in an HttpOnly
  `SameSite=Lax` cookie scoped to `/api/v1/auth/oauth/`, which defeats login CSRF.
- **ID token validated without JWKS.** The token is received directly from Google's token
  endpoint over verified TLS in exchange for the client secret and PKCE verifier, which OIDC
  Core 3.1.3.7 (6) accepts in place of signature validation; `iss`, `aud`, `exp` and `nonce`
  are checked.

## D39 — System mail is sent after the response
Verification and reset messages are handed to FastAPI background tasks instead of being sent
inside the request. A real SMTP round trip (hundreds of milliseconds) would otherwise make
`register` and `password/forgot` measurably slower for addresses that get mail, revealing which
addresses exist. Celery was not used: the task would have to carry the address and the one-time
token, and Celery arguments must hold only IDs. A process restart between the response and the
send loses the message; the user can request a new one (resend is rate limited).

## D40 — Auto-deploy builds on the server after green CI
Every push to `main` whose CI (backend and frontend suites) is green is deployed by the `deploy`
job in `.github/workflows/ci.yml`: SSH to the server, `scripts/deploy.sh <sha>`, which checks out
the tested commit and runs `docker compose up -d --build`. Images are built on the server rather
than pushed to a registry: it matches the documented production command, needs no registry
credentials and keeps one server simple. The cost is build time and CPU on the server and a short
restart window. The job deploys the exact tested SHA, not the branch head, and holds only a
dedicated SSH key. No automatic rollback; reverting on `main` redeploys the previous state.
