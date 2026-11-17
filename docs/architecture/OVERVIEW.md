# Architecture overview

## Runtime topology

```
Browser ──HTTPS──> Nginx ──┬── /api/*  ──> backend (FastAPI, uvicorn)
                           └── /*      ──> frontend (Next.js)

backend ──> PostgreSQL          celery_worker ──> PostgreSQL, Redis, provider APIs
backend ──> Redis               celery_beat   ──> Redis (schedules periodic sync / cleanup)
backend ──> provider APIs
```

Only Nginx publishes ports. PostgreSQL and Redis sit on an internal Docker network.
The browser talks to one origin, so session cookies are first-party and `SameSite=Lax`.

## Backend

A modular monolith (`backend/app`). Each business module follows clean architecture:

| Layer | Contents | May depend on |
|---|---|---|
| `domain` | entities, value objects, domain errors | standard library, `app.shared.domain` |
| `application` | use cases, ports (Protocols), DTOs | domain, other modules' public interfaces |
| `infrastructure` | SQLAlchemy models, repositories, adapters | application, domain, `app.core` |
| `presentation` | FastAPI routers, Pydantic schemas | application, `app.core` |

`app.core` holds cross-cutting technical concerns (config, database, security primitives,
middleware). `app.integrations.email_providers` holds provider adapters behind one contract.
`app.infrastructure` holds Celery, Redis and mailer wiring.

Composition happens in `presentation/dependencies.py` of each module (FastAPI `Depends`) and in
`app/infrastructure/celery/container.py` for workers. Nothing else instantiates infrastructure.

## Request lifecycle

1. Nginx forwards to FastAPI.
2. Middleware: request ID, security headers, trusted host, body-size limit, CSRF.
3. `get_current_session` resolves the session cookie to a user (hash lookup).
4. `get_tenant_session` opens a transaction and sets `app.current_user_id` transaction-locally.
5. The router calls one application use case with the authenticated `user_id`.
6. Repositories filter by `user_id`; RLS enforces the same rule in the database.
7. Domain errors are mapped to a uniform error envelope.

## Background work

Celery tasks receive IDs only. Each task opens its own tenant-scoped transaction, re-reads the
account, verifies it is active, takes a per-account Redis lock, obtains credentials from the Token
Vault and runs the provider-specific synchronizer. See `docs/EMAIL_SYNC.md`.

## Frontend

Next.js App Router with locale-prefixed routes (`/en`, `/uk`). Feature modules under
`src/modules`, shared primitives under `src/shared`, technical plumbing under
`src/infrastructure`. All server state goes through TanStack Query and one typed API client that
attaches the CSRF header and handles session expiry. See `FRONTEND_MODULES.md` and
`RESPONSIVE_ARCHITECTURE.md`.

## Extraction path

Module public interfaces are Protocols plus DTOs, and modules never share ORM models, so a module
can later be moved behind a network boundary by swapping the in-process adapter for a client.
