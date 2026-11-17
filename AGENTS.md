# AGENTS.md — MailFlow

Source of truth for every human or AI contributor. Read this first, then the docs it links.

## Product

MailFlow is a multi-tenant SaaS email client. Independent users register, connect several external
mailboxes (Gmail first; Outlook and IMAP/SMTP later) and work with them through one unified,
fully responsive interface in English or Ukrainian, light or dark.

Two separate authentication systems exist and must never be conflated:

- **MailFlow authentication** — registration, login, sessions, verification, password reset.
- **External mailbox authentication** — Gmail OAuth, Microsoft OAuth, IMAP/SMTP credentials.

## Scope (MVP)

Authentication, connected accounts, unified inbox, reading, threads, compose/reply/forward, drafts,
folders, message actions, search, attachments, settings, background sync. Nothing else without
approval. See `docs/architecture/IMPLEMENTATION_CHECKLIST.md` for what is actually done.

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 async, Alembic, Celery, Redis, HTTPX |
| Frontend | Next.js App Router, React, strict TypeScript, Tailwind, Radix/shadcn-style UI, TanStack Query, React Hook Form, Zod, next-intl |
| Data | PostgreSQL (primary), Redis (broker, cache, locks, rate limits) |
| Infra | Docker Compose, Nginx as the only public entry point |

Deviations go in `docs/DECISIONS.md`.

## Architecture in one page

Modular monolith, clean architecture inside each module:

```
presentation  ->  application  ->  domain
                      ^
infrastructure -------+   (implements ports declared by application/domain)
```

- `domain` — pure Python. No FastAPI, SQLAlchemy, Redis, Celery, HTTPX, provider SDKs.
- `application` — use cases and ports (Protocols). No FastAPI, no SQLAlchemy.
- `infrastructure` — ORM models, repositories, adapters.
- `presentation` — routers and Pydantic schemas. No business logic.

Modules talk to each other only through each module's public interface (`app.modules.<name>`
package exports / `application` ports). Never import another module's `infrastructure` or
`presentation`. Enforced by `backend/tests/architecture`.

Details: `docs/architecture/OVERVIEW.md`, `BACKEND_MODULES.md`, `MODULE_BOUNDARIES.md`,
`DEPENDENCY_RULES.md`, `PROVIDER_ARCHITECTURE.md`.

## Multi-tenancy rules (non-negotiable)

1. Every user-owned row carries `user_id`.
2. The acting user comes only from the validated server-side session. Never from a request body,
   query string or path.
3. Every repository method for user-owned data takes `user_id` and filters on it.
4. A resource that exists but belongs to someone else is reported as **404**, never 403.
5. PostgreSQL Row-Level Security is enabled as defense in depth. Tenant context is set with
   `set_config('app.current_user_id', ..., true)` — transaction-local only.
6. Celery tasks carry only IDs. They re-read the account, re-check ownership and active status,
   and fetch credentials from the Token Vault inside the worker.
7. Every new user-owned resource ships with a cross-tenant test.

Details: `docs/architecture/DATA_OWNERSHIP.md`, `docs/SECURITY.md`.

## Security rules

- Argon2id for passwords. Opaque session tokens, stored hashed, delivered in HttpOnly cookies.
- CSRF: double-submit token plus Origin check on every state-changing request.
- Provider credentials live only in the Token Vault (AES-256-GCM, keys from environment).
- Never log passwords, tokens, cookies, email bodies or attachment content.
- All email HTML is untrusted: sanitized server-side, rendered in a sandboxed iframe, remote
  images blocked by default.
- User-supplied hosts (IMAP/SMTP) go through the SSRF guard — resolve, validate every IP, connect
  to the validated IP.
- No hidden administrative access to mail content.

## Responsive rules

Mobile and desktop are equal first-class targets. Read
`docs/architecture/RESPONSIVE_ARCHITECTURE.md` before touching UI.

- Mobile-first styles; widen with `md` (768) / `lg` (1024) / `xl` (1280) / `2xl` (1536).
- Phone: single pane + bottom navigation + drawer. Tablet: collapsible rail + list/reader.
  Desktop: three panes.
- `100dvh`, safe-area insets, 44px touch targets, no hover-only actions.
- No page-level horizontal overflow at any width from 320px up, in either language.
- A UI change is not done until it is checked on phone, tablet and desktop, both themes, both
  locales.

## Coding standards

Python: type hints everywhere, Ruff + MyPy clean, small functions, structured logging, no global
mutable state. TypeScript: strict, no `any`, feature modules, Zod at boundaries, no hardcoded UI
strings (use `messages/en.json` and `messages/uk.json`).
Details: `docs/development/CODING_STANDARDS.md`.

## Testing

- Backend: `cd backend && uv run pytest` (needs the dev Postgres/Redis from
  `docker compose -f docker-compose.dev.yml up -d`).
- Static: `uv run ruff check . && uv run mypy app`.
- Frontend: `cd frontend && pnpm test` (Vitest), `pnpm e2e` (Playwright viewport matrix).
- Never report a test as passing without running it.

Details: `TESTING.md`, `docs/development/TESTING_STRATEGY.md`.

## Workflow

1. Read this file, `CLAUDE.md`, `README.md`, the relevant docs, `git status`, recent commits.
2. Plan: affected modules, schema, API, responsive and security implications, tests.
3. Implement inside module boundaries.
4. Run the relevant tests and linters.
5. Update docs, `CHANGELOG.md`, `docs/DECISIONS.md`, `docs/LIMITATIONS.md`.
6. Report honestly, including what is unfinished.

## Forbidden

- Business logic in route handlers or React presentation components.
- Trusting client-supplied owner identifiers.
- Credentials in logs, API responses, Celery arguments, frontend code or localStorage.
- Fake buttons, simulated success, mock production data.
- Claiming provider support that is not implemented and tested.
- Desktop-only or mobile-only UI.
- Undocumented architecture changes; fabricated test results.
