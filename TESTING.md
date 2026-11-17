# Testing

Strategy and conventions: [`docs/development/TESTING_STRATEGY.md`](docs/development/TESTING_STRATEGY.md).

## Backend

Needs the development PostgreSQL, Redis and the GreenMail IMAP/SMTP test server (loopback only):

```bash
docker compose -f docker-compose.dev.yml up -d
```

```bash
cd backend && uv run pytest
```

```bash
cd backend && uv run pytest --cov=app --cov-report=term-missing
```

```bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app
```

Tests use the `mailflow_test` database: migrations are applied as the owner role and the tests
connect as the restricted `mailflow_app` role, so row-level security is really in force. External
APIs are never called: the Gmail adapter is tested with `respx`, flows with an in-memory provider.
The IMAP adapter is the exception that talks to a real server — the local `greenmail` container —
through the real transport with certificate verification on (`tests/integration/test_imap.py`,
`tests/security/test_imap_security.py`); its unit tests use in-process TLS servers and fakes
(`tests/unit/test_imap_adapter.py`). Without the container those two files fail with a message
saying how to start it.

| Suite | Path | Covers |
|---|---|---|
| Unit | `tests/unit` | Sanitizer, filenames, SSRF guard, Argon2, vault cipher, thread rules, Gmail mapper/OAuth/provider |
| Integration | `tests/integration` | Auth, accounts + OAuth flow, sync, mail API, compose, drafts, search |
| Security | `tests/security` | Tenant isolation (API + RLS), account deletion |
| Architecture | `tests/architecture` | Layer rules, module boundaries, cycles, task signatures |

## Frontend

```bash
cd frontend && pnpm lint && pnpm typecheck && pnpm test
```

```bash
cd frontend && pnpm e2e
```

Playwright runs against the Next.js app with the API mocked at the network layer and covers the
viewport matrix; see [`docs/development/RESPONSIVE_DEVELOPMENT.md`](docs/development/RESPONSIVE_DEVELOPMENT.md).

## Results

Results are recorded in `CHANGELOG.md` per milestone. Never report a result that was not produced
by an actual run.
