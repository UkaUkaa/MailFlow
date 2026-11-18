# Changelog

## [Unreleased]

### Added
- **Write with AI for new emails and forwards** (D45). The composer's AI button now works in every
  mode: a short note becomes the full email, written as the chosen mailbox, in the note's
  language; an empty subject is filled with a suggested one. `POST /assistant/compose`.

### Changed
- The composer always shows which mailbox the email is sent from (mark, name and full address),
  on phone, tablet and desktop, even with a single mailbox; with several it is a picker.
- Remote images in emails are shown by default for new users. Existing users keep their saved
  choice; anyone can turn images off in Settings → Appearance (D41). Until settings load, the
  reader keeps remote images blocked.
- The open mailbox list refreshes itself every 2 minutes, so mail brought in by the background
  sync appears without reloading. Search results are not polled; hidden tabs do not poll.

### Fixed
- **Unreadable emails on iPhone when the theme differs from the phone's.** Emails without colours
  of their own (e.g. sent from a template) declared `color-scheme: light dark` in the reader frame.
  With MailFlow on the light theme and the iPhone in dark mode, the frame's scheme no longer matched
  the page's and Safari painted an opaque black backdrop under the light theme's dark text (and
  white on white in the opposite case). The frame document and the iframe element now share exactly
  one scheme: the app's resolved theme for such emails, light for styled ones.
- **Tooltips piling up on the rail.** Collapsing the side menu could show the tooltip of every
  item hovered while it was expanded, all at once. A tooltip now forgets any open requested
  while it was switched off, and tooltips open on mouse hover only — no longer on focus, so a
  control that keeps focus after a click does not keep its tooltip.
- **Send later failed with 422.** The browser stores the `mf_tz` cookie URL-encoded
  (`Europe%2FKyiv`) and the server did not decode it, so every scheduled send and reschedule was
  rejected with `timezone_required`. The server now percent-decodes the zone name.
- **Home-screen app on iPhone.** MailFlow had no web app manifest, so iOS guessed the app's scope
  from the page that was added and showed the browser's address bar and back/forward controls on
  navigation outside it. Added `app/manifest.ts` (`scope` and `start_url` `/`, `standalone`),
  PNG app icons, the Apple web-app meta tags, and `public/` in the frontend Docker image.

### Added
- **Delete or deactivate a Google-only account.** Users who signed up with Google never chose a
  password, so the confirmation dialog could not be completed. When a Google account is linked,
  Settings → Delete account now offers "Confirm with Google": a fresh Google sign-in
  (`prompt=login`, `max_age=300`) with the same linked Google account issues a single-use,
  purpose-bound grant (HttpOnly `mf_reauth` cookie, 5 minutes) that stands in for the password.
  The password still works for everyone; deletion still needs the typed `DELETE` (D44).
- **Templates.** Settings → Templates lists, creates, edits and deletes reusable messages
  (name, subject, formatted body). In the composer a Templates menu inserts one — into an empty
  body whole, otherwise at the caret — filling `{{first_name}}`, `{{name}}`, `{{email}}`,
  `{{my_name}}` and `{{date}}`, and "Save as template" stores what is being written. Backend
  module `templates`, `/templates` API, table `message_templates` (migration 0007, tenant RLS).
- **AI replies with your own key** (D43). In Settings → AI replies each user connects their own
  ChatGPT (OpenAI), Claude (Anthropic) or Gemini (Google) API key — checked with the provider,
  stored encrypted in the Token Vault, shown only as its last four characters — and picks a model
  from those the key can use. "Write with AI" in the reply composer turns a short note into the
  full reply, in the user's own style (from their sent mail to the same person) and in the
  language of the conversation. Backend module `assistant` (OpenAI and Gemini over HTTPX, Claude
  via the Anthropic SDK), `/assistant` API, tables `user_secrets` and `assistant_configs`
  (migration 0007, tenant RLS); Privacy Policy updated.
- **Send later and undo send** (D42). A "Send later" menu next to Send (later today, tomorrow
  morning, Monday morning, or any date and time), a Scheduled view to reschedule or cancel what
  is waiting, and an Undo toast after every send for a configurable window (Settings: off, 5,
  10, 20 or 30 s; default 5 s). Both run on a server-side scheduled outbox (`outbox_items`,
  migration 0006, tenant RLS): `POST /emails/send` accepts `send_at` and answers `202` for held
  messages; new `/outbox` endpoints list, reschedule and cancel. Celery beat task
  `outbox.dispatch_due` and worker task `outbox.send` deliver due messages exactly once.
  Scheduled times are picked in the user's own time: the browser reports its time zone in the
  `mf_tz` cookie and the server converts local time to UTC. The user's time is printed to the
  browser console on load.
- CI (`.github/workflows/ci.yml`): backend ruff, mypy and pytest against the dev
  PostgreSQL/Redis/GreenMail services; frontend lint, typecheck, Vitest, build and Playwright
  e2e. Runs on every PR and push to `main`.
- Auto-deploy: when CI is green on `main`, the `deploy` job runs `scripts/deploy.sh` on the
  server over SSH (tested commit, `docker compose up --build`, health wait). Configured through
  `DEPLOY_*` repository variables and secrets; skipped until they are set. See `docs/DOCKER.md`.

### Fixed
- The "send a new verification email" button wraps instead of overflowing a 320 px screen in
  Ukrainian (caught by the e2e viewport matrix in CI).
- AI pull-request review (`.github/workflows/ai-pr-review.yml`): on every non-draft PR an AI
  agent (Claude Sonnet 5.5 via `anthropics/claude-code-action`) scores the code 1-10, writes a short code
  review in Russian and lists recommendations only when they matter. One comment per PR,
  updated on each push. Needs the `ANTHROPIC_API_KEY` repository secret; fork PRs are skipped.
- Real delivery of verification and password reset emails. `SMTP_TLS` adds implicit TLS
  (port 465) next to `SMTP_STARTTLS`; messages carry `Date`, `Message-ID` and
  `Auto-Submitted` headers so receiving servers accept them. Production refuses to start
  when `SMTP_HOST` is empty, Mailpit or loopback, or when SMTP is unencrypted.
- System mail is sent after the HTTP response (FastAPI background task), so a slow SMTP
  server neither delays registration/reset nor makes their timing depend on whether the
  address is registered.
- Sign in with Google: "Continue with Google" on the sign-in and registration screens (shown
  only when `GOOGLE_CLIENT_ID`/`SECRET` are set; `GET /auth/providers`). OpenID Connect with
  state, PKCE and nonce; the state is single-use (Redis) and bound to the browser by an HttpOnly
  cookie against login CSRF. Scopes `openid email profile` only — no mailbox access. The first
  sign-in creates a verified account, later ones find it by the Google account ID
  (`user_identities`, migration `0004`); an existing account with the same verified address is
  linked. Callback: `{APP_BASE_URL}/api/v1/auth/oauth/google/callback`.
- Public Privacy Policy (`/{locale}/privacy`) and Terms of Service (`/{locale}/terms`) in English
  and Ukrainian, with the Google API Services User Data Policy / Limited Use disclosure required
  for OAuth verification; linked from every signed-out screen.
- Progress for thread actions: while an action (single or bulk) waits for the server, a centred
  card with a spinner names it and its count ("Moving 3 conversations to trash…") and blocks
  the rest of the app (modal: pointer, keyboard and Escape) until the server answers. It fades
  in after 200 ms so quick actions do not flash; marking a conversation read on open does not
  show it.
- Bulk selection in the conversation list: "Select conversations" in the list header (and a
  long press on a row on touch screens) turns rows into checkboxes; a toolbar applies mark
  read/unread, archive or move to inbox, move to trash or restore, spam / not spam and star /
  unstar to the whole selection through `POST /threads/actions` (split into requests of 100).
  "Select all" covers the loaded conversations; Escape or the close button leaves. Archive and
  spam are offered only when every selected mailbox supports them. Moves show an undo toast.
- Settings → Interface: message-list density (comfortable / compact), preview lines (off / 1 / 2),
  sender pictures on/off, mailbox colour wash (off / subtle / strong), app accent colour (blue,
  violet, green, orange, pink, graphite) and the reader's base text size, with a live preview
  and "Reset to defaults". Stored on the account (`/settings`, migration `0003`) and applied
  through `<html>` data attributes, cached locally so a reload does not flash the default layout.
- Account appearance: any RGB colour per mailbox (presets, the platform colour picker or a hex
  code) and an optional picture (PNG/JPEG/WebP, cropped and re-encoded to 96×96 in the browser;
  its average colour is suggested). `PUT`/`DELETE`/`GET /accounts/{id}/avatar`,
  `Account.avatar_updated_at`. The picture replaces the colour dot in the list, the reader, the
  account switcher and settings.
- Message rows in the thread list are washed with their mailbox colour (theme tokens
  `--account-tint-rest` / `--account-tint-hover`), with a preview in the edit dialog.

### Fixed
- A thread action (single or bulk) that failed showed only "The action could not be completed."
  It now names the cause: for a mailbox that lost authorization (`409 provider_auth_required`)
  the toast says it must be reconnected and offers "Reconnect" (Settings → Accounts); provider
  outages, rate limits, unsupported actions and offline errors get their own messages too.
- Saving an account colour failed with 422: the UI sent hex values, the API accepted only colour
  names. Colours are now `#rrggbb` throughout (migration `0002` converts stored names).

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

- Navigation is one layout: the collapsed rail and the expanded menu are the same rows (fixed
  icon cell + label), so expanding only widens the column (animated, 180ms) and reveals labels
  and unread counts; no icon, the toggle included, changes position. Accounts are rows of the
  column in both states; language and theme are the same two rows ("Language: …", "Theme: …");
  the stored state is applied before first paint. The overlay flyout, the accent Compose button
  and the segmented switches in the menu are removed; the phone drawer uses the same rows.
- Navigation: an "Expand menu" button on the rail and "Collapse menu" in the menu header;
  language and theme switches in the rail (compact) and in the full menu and phone drawer.

### Fixed
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
