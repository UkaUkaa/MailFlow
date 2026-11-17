# MailFlow

A multi-tenant SaaS email client. Independent users register, connect several external mailboxes
and work with them through one unified, fully responsive interface (English and Ukrainian, light
and dark).

**Status:** MVP foundation. Gmail is the implemented provider; Outlook (Microsoft Graph) is
implemented but so far tested only against a mocked API; generic IMAP/SMTP is implemented and
tested only against a local test server. See [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) and
[`docs/architecture/IMPLEMENTATION_CHECKLIST.md`](docs/architecture/IMPLEMENTATION_CHECKLIST.md)
for exactly what is and is not done.

## Stack

FastAPI · SQLAlchemy 2 (async) · PostgreSQL with row-level security · Redis · Celery ·
Next.js (App Router) · TypeScript · Tailwind · Docker Compose · Nginx.

## Quick start (Docker)

```bash
./scripts/generate-env.sh
```

```bash
docker compose up --build
```

- App: <http://localhost:8080>
- Verification / reset emails (Mailpit): <http://127.0.0.1:8025>

Register, open the verification email in Mailpit, sign in. To connect Gmail, set
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env` first — see
[`docs/EMAIL_INTEGRATION.md`](docs/EMAIL_INTEGRATION.md). Without them the app runs and shows the
provider as not configured.

## Local development

```bash
docker compose -f docker-compose.dev.yml up -d
```

Backend (Python 3.12, [uv](https://docs.astral.sh/uv/)):

```bash
cd backend && uv sync && uv run alembic upgrade head && uv run uvicorn app.main:app --reload
```

Frontend (Node 22+, pnpm):

```bash
cd frontend && pnpm install && pnpm dev
```

The dev frontend proxies `/api` to `http://localhost:8000`. Tests: see [`TESTING.md`](TESTING.md).

## Documentation

| Topic | Document |
|---|---|
| Contributor / agent rules | [`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md) |
| Architecture | [`docs/architecture/`](docs/architecture/OVERVIEW.md) |
| API | [`docs/API.md`](docs/API.md) |
| Database | [`docs/DATABASE.md`](docs/DATABASE.md) |
| Security | [`docs/SECURITY.md`](docs/SECURITY.md) |
| Gmail setup, providers | [`docs/EMAIL_INTEGRATION.md`](docs/EMAIL_INTEGRATION.md) |
| Synchronization | [`docs/EMAIL_SYNC.md`](docs/EMAIL_SYNC.md) |
| Frontend, i18n | [`docs/FRONTEND.md`](docs/FRONTEND.md), [`docs/I18N.md`](docs/I18N.md) |
| Docker, environment variables | [`docs/DOCKER.md`](docs/DOCKER.md) |
| Decisions, limitations | [`docs/DECISIONS.md`](docs/DECISIONS.md), [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) |
| Development guides | [`docs/development/`](docs/development/DEVELOPMENT_WORKFLOW.md) |
