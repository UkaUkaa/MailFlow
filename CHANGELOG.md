# Changelog

## [Unreleased]

### Added
- Architecture, security, data-ownership, provider, responsive and design-system documentation;
  `AGENTS.md`, `CLAUDE.md`, agent definitions.
- Backend (FastAPI modular monolith): authentication (registration, verification, login, logout,
  password reset/change, sessions), users, settings, Token Vault (AES-256-GCM keyring),
  email accounts with Gmail OAuth (PKCE), Gmail adapter, synchronization (initial, incremental,
  backfill, scheduler), threads/messages/actions, compose/reply/forward, drafts, attachments,
  full-text search, audit trail.
- PostgreSQL schema with row-level security, restricted application role, definer functions for
  scheduling and cleanup.
- Celery worker and beat; Redis rate limiting, locks and idempotency.
- Docker Compose stack with Nginx entry point, hardened containers, production override.
- Backend test suites: unit, integration, security (tenant isolation, RLS, deletion), architecture.

- Frontend (Next.js 16, App Router): auth screens, responsive shell, thread list, reader with
  sandboxed email frame, composer with drafts and attachments, settings, en/uk, light/dark.

- Outlook / Microsoft 365 provider on Microsoft Graph v1.0: OAuth 2.0 + PKCE client, mapper and
  adapter implementing the whole provider contract (mailbox listing, per-folder delta sync behind
  one opaque cursor, immutable ids, conversation actions, send/reply/forward through drafts,
  attachments incl. upload sessions, drafts), worker pacing (`OUTLOOK_SYNC_REQUESTS_PER_MINUTE`),
  configuration (`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT`,
  `MICROSOFT_REDIRECT_URI`) and "Connect Outlook" in Settings → Connected accounts.
  **Tested against a mocked Graph only — not yet run against a live Microsoft account.**
- `ResilientHttp.request(passthrough=...)` so an adapter can read a provider error code.

- Generic IMAP/SMTP provider (`app/integrations/email_providers/imap`), the first password-based
  one: guarded transport on the standard library (SSRF guard on every connect and reconnect,
  socket to the validated IP, TLS with certificate and host name verification, implicit TLS or
  STARTTLS only), MIME parser/builder, folder roles (SPECIAL-USE with name fallback), per-folder
  UID synchronization behind one cursor (new mail, flags with CONDSTORE or a recent window,
  expunges, UIDVALIDITY → rebuild), flags and moves (`UID MOVE` / COPY + `UID EXPUNGE`), SMTP send
  with a copy in Sent, drafts by `APPEND`, attachments by part id.
  **Tested against a local test server only — not against real-world IMAP/SMTP servers.**
- `POST /accounts/imap` and `POST /accounts/{id}/imap/credentials`: both logins checked before
  anything is stored, uniform error codes, 10 attempts/hour per user and 20 per IP.
- Contract: `ServerCredentials`, `MailEndpoint`, `MailSecurity`, `Relocation`, `ClosableProvider`,
  `ProviderTlsRequired`, `ProviderDestinationBlocked`, `ProviderRegistry.verify_credentials`.
  `ProviderSessionFactory` handles password providers (no refresh) and closes adapters.
- Account `capabilities` are per account: `archive` / `spam` / `drafts` are false for an IMAP
  mailbox without such a folder; the mail UI hides actions an account cannot do.
- Settings → Connected accounts: "Connect another mail account (IMAP)" dialog and a password-only
  reconnect dialog (en/uk).
- Settings `MAIL_CONNECT_TIMEOUT_SECONDS`, `MAIL_IO_TIMEOUT_SECONDS`; test-only
  `SSRF_ALLOW_PRIVATE_NETWORKS`, `MAIL_TLS_CA_FILE` (refused unless `ENVIRONMENT=test`).
- `greenmail` service in `docker-compose.dev.yml` with a test-only certificate in
  `infra/greenmail/`.

### Changed
- `modify_thread` / `modify_message` may return `Relocation`s; stored messages, conversations and
  attachments follow a message whose provider id changed.
- `POST /accounts/{id}/reconnect` answers 422 `unsupported` for non-OAuth mailboxes.
- Removed the empty `email_providers/smtp` placeholder package (SMTP lives in `imap.transport`).

### Changed
- The OAuth callback accepts authorization codes up to 8,192 characters (Microsoft's are long).
- `/accounts/oauth/outlook/start` answers 503 `provider_not_configured` instead of 404 when
  Outlook is not configured.

### Changed
- Frontend layout reworked after `docs/design/SPARK_REFERENCE.md` (layout and behaviour only;
  MailFlow's own palette, mark and Lucide icons):
  - navigation: 70px icon rail from 768px with tooltips, a flyout with the full navigation
    (keyboard operable, focus returns) and an optional pinned sidebar; phones keep bottom
    navigation and drawer;
  - thread list: date groups (Today … month + year, browser time zone, locale week start),
    88px three-line rows with avatars, count chip, gutter quick actions on hover and keyboard
    focus, accent-tint selection, search and new-message icons in the header;
  - reader: toolbar pill (back | archive) and icon buttons, messages as bordered cards with
    per-message reply / forward, collapsed quoted history, compact draft card (Edit / Delete),
    glyph-only empty pane;
  - composer: document-like page beside the rail from 768px, replies docked in the reading pane
    from 1024px (expand / dock), one "To, Cc, Bcc" line that opens on focus;
  - search: a mode of the list pane with in-memory recent queries; Escape returns to the list;
  - settings: modal dialog over the mail workspace from 768px (deep links and the OAuth return
    open it directly), full pages on phones.
- Design tokens: new `--rail`; neutrals re-tuned into three tonal steps in both themes;
  `--warning`, `--success`, `--danger` (light) and `--accent` (dark) adjusted; contrast table in
  `DESIGN_SYSTEM.md`.
- Removed strings `nav.toggleSidebar`, `composer.minimize`, `composer.ccBcc`,
  `mail.searchPrompt*`; the floating, minimizable composer is gone.

- Navigation: an "Expand menu" button on the rail and "Collapse menu" in the menu header;
  language and theme switches in the rail (compact) and in the full menu and phone drawer.

### Fixed
- Escape now closes the navigation flyout even while a tooltip of a focused button is open.
- Escape did not close the composer while the caret was in the message body.
- Closing the phone drawer did not return focus to the menu button.
- Search by email address returned nothing (tsquery tokenisation).
- A conversation left an empty stale row when a draft moved to another thread.
- Hydration mismatch when the page was delivered buffered behind Nginx (theme script in `<head>`).
- Nginx did not forward the public host to the frontend.

- Gmail sync exhausted the per-user quota on real mailboxes (6,000 units/min, 60 units per full
  message read): calls are now paced by quota cost, pages are smaller, and rate limits are retried
  after 90 s instead of backing off exponentially. Rate-limit events are logged with the endpoint
  and Google's quota name.

### Verified (actual runs)
- Live Gmail: three mailboxes connected and synchronized without rate-limit errors after the fix.
- Backend: 233 tests passed; coverage 95%; Ruff clean; MyPy strict clean.
- Frontend: lint and typecheck clean; Vitest 67 passed; Playwright 100 passed; production build ok.
- Docker: all services healthy; browser flow through Nginx against the real API.

### Not yet implemented
- Live verification of the Outlook and IMAP/SMTP providers. See `docs/LIMITATIONS.md`.
