# Testing strategy

## Principles

- Test behaviour through public interfaces: HTTP for flows, use cases for worker logic, pure
  functions for rules.
- Real PostgreSQL (with RLS and the restricted role) and real Redis; no mocking of our own
  database layer.
- No network: provider HTTP is mocked with `respx`; flows use `tests/fakes.py`.
- Every user-owned resource has a cross-tenant test. Security controls have negative tests.
- A failing test is fixed or the code is fixed; tests are never deleted to get green.

## Backend layers

| Kind | What belongs here |
|---|---|
| Unit | Sanitizer payload corpus, filename/MIME hygiene, SSRF ranges, cipher, thread-state rules, provider mapping and error handling |
| Integration | Auth lifecycle, CSRF, rate limits, OAuth state/PKCE, sync (initial, incremental, backfill, cursor expiry, locking, failure isolation), mail API, compose idempotency, drafts |
| Security | IDOR on every endpoint, forged identifiers, RLS without context, cross-tenant writes, pooled-connection reuse, concurrency, deletion completeness |
| Architecture | Import rules per layer, module privacy, cycles, Celery task signatures |

Fixtures (`tests/conftest.py`): `alice` / `bob` are registered, verified, logged-in actors with
their own HTTP clients; `connect_mailbox` runs the real OAuth flow against the fake provider;
`runner` is the real `SyncRunner`.

## Frontend layers

| Kind | Tool | What |
|---|---|---|
| Unit / component | Vitest + Testing Library | API client, schemas, form validation, key components |
| End-to-end | Playwright with network-level API mocks | Auth flows, inbox, reader, composer, navigation, session expiry |
| Responsive | Playwright viewport matrix | Overflow, visibility of primary actions, touch targets, screenshots |

## Coverage

Target ≥ 80% on business logic, higher on authentication, authorization, encryption and tenant
isolation. Coverage is measured with greenlet tracing enabled (required for SQLAlchemy async).

## Not covered by automation

Live Gmail API behaviour, real mobile browsers and on-screen keyboards, TLS configuration.
These need manual verification and are listed in `docs/LIMITATIONS.md`.
