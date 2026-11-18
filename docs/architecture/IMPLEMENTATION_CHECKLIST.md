# Implementation checklist

Status legend: `[x]` done and tested, `[~]` partial (see `docs/LIMITATIONS.md`), `[ ]` not started.
Update this file whenever an item changes state.

## Phase 1 — Discovery and architecture
- [x] Architecture, module boundaries, data ownership, provider contract, responsive architecture, design system
- [x] API contract (`docs/API.md`)
- [x] `AGENTS.md`, `CLAUDE.md`, agent definitions (`.claude/agents`)

## Phase 2 — Infrastructure
- [x] Backend skeleton, validated configuration, health checks
- [x] PostgreSQL (owner + restricted role), Redis, Celery worker + beat
- [x] Alembic migrations (schema, RLS, definer functions)
- [x] Docker Compose, Nginx, hardened containers — backend services verified running and healthy
- [x] Frontend container and full stack through Nginx (all nine services healthy)

## Phase 3 — Authentication and multi-tenancy
- [x] Registration, verification, login, logout, password reset/change
- [x] Sign in with Google (OIDC, `openid email profile`); real Google exchange not yet exercised end-to-end
- [x] Public Privacy Policy and Terms of Service pages (en, uk)
- [x] Sessions (list, revoke, expiry, idle timeout), CSRF, rate limiting, security headers, trusted hosts
- [x] Tenant context + RLS + composite foreign keys
- [x] Token Vault (AES-256-GCM keyring, AAD binding, rotation)
- [x] Security tests (IDOR, RLS, pooled connections, concurrency, deletion)

## Phase 4 — Gmail integration
- [x] OAuth (state, PKCE), connect / reconnect / disconnect with revocation
- [x] Gmail adapter: list, get, threads, labels, history sync, modify, trash, send, drafts, attachments
- [x] Initial + incremental sync, backfill, cursor-expiry rebuild, scheduler, locks
- [~] Verified against mocked Gmail responses only; **not yet run against the live Gmail API**

## Phase 5 — Email application (API)
- [x] Unified and per-account thread lists, all views, custom folders, keyset pagination
- [x] Conversation detail, message actions, bulk actions
- [x] Compose / reply / reply-all / forward with idempotent send
- [~] Drafts (provider-backed; attachments are not saved with drafts)
- [x] Attachments (metadata + safe download), search, unread counts
- [x] Send later and undo send on a scheduled outbox (D42): schedule, list, reschedule, cancel,
      exactly-once dispatch by Celery; verified with the fake provider and GreenMail SMTP
- [x] Account deletion and deactivation

## Phase 6 — Responsive frontend
- [x] Auth screens, app shell (phone / tablet / desktop / ultrawide), inbox, reader, composer, settings
- [x] Light and dark themes, English and Ukrainian with equal coverage
- [x] Playwright viewport matrix (15 sizes + landscape, both locales) with screenshot review
- [x] Layout reworked after `docs/design/SPARK_REFERENCE.md`: rail that expands in place, date-grouped list,
      message cards, page / docked composer, search mode, settings dialog (Chromium only)
- [x] Account appearance: any RGB colour, optional picture, colour wash on message rows
- [x] Interface settings: list density, preview lines, sender pictures, wash strength, accent colour, reader text size
      (backend + unit/integration/e2e; screenshots at 375, 820, 1440 px, both themes and locales)
- [~] Mail screens are verified with mocked API data; against the real backend only the
      no-mailbox states were exercised (no Google credentials available)
- [~] Virtual keyboard and safe areas verified by viewport emulation, not on physical devices

## Phase 7 — Additional providers
- [~] Microsoft Graph (Outlook) — adapter, OAuth and UI implemented and tested against a mocked Graph; not yet run against a live Microsoft account
- [~] IMAP/SMTP — adapter, guarded transport, password connect/reconnect API and UI implemented;
      tested against a local GreenMail server and scripted servers only, not against any
      real-world IMAP/SMTP server (CONDSTORE, SPECIAL-USE and STARTTLS paths: unit tests only)

## Phase 8 — Testing and security review
- [x] Backend: unit, integration, security, architecture suites; Ruff; MyPy strict
- [x] Frontend: ESLint, TypeScript, Vitest (204), Playwright (142, incl. hydration regression)
- [~] Security review: internal checklist applied; no external assessment

## Phase 9 — Finalization
- [x] Dockerized API smoke test: register → verification email → verify → login → delete
- [x] `docker compose up --build` of the complete stack; browser check through Nginx: register → verify → sign in → inbox and settings, phone and desktop, en and uk
- [ ] End-to-end verification with a real Gmail account
