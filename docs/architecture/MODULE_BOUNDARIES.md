# Module boundaries

## Public interface

A module's public interface is what its `application` package exposes: use-case classes, ports
(Protocols) and DTOs, plus domain entities and errors. Other modules may import:

- `app.modules.<other>.application...`
- `app.modules.<other>.domain...`

Other modules must **not** import:

- `app.modules.<other>.infrastructure...` (ORM models, repositories)
- `app.modules.<other>.presentation...` (routers, schemas)

Composition is the only place where implementations meet ports:

1. **`app/bootstrap.py`** — `Runtime` (process singletons) and `Services` (use cases bound to one
   database session). Shared by the API and the Celery workers.
2. **Presentation layers** — routers obtain use cases from `app.api.deps` (`Auth`, `Svc`).
   `authentication/presentation/dependencies.py` additionally wires the authentication use cases
   and owns `require_auth`.
3. **`app/infrastructure/celery`** — builds the worker runtime.
4. **Model registry** — `app/core/database/registry.py` imports every ORM model so Alembic sees
   the full metadata.

Everything else — every `domain`, `application` and `infrastructure` package — may never import
another module's `infrastructure` or `presentation`.

## Layer rules

| Layer | Must not import |
|---|---|
| `domain` | fastapi, sqlalchemy, redis, celery, httpx, pydantic, `app.core`, any `infrastructure`/`presentation` |
| `application` | fastapi, sqlalchemy, redis, celery, any `presentation`, any `infrastructure` |
| `infrastructure` | fastapi, starlette, any `presentation` |
| `presentation` | business rules of its own (it maps HTTP to use cases) |

## Providers

`app.integrations.email_providers.contracts` is the only package modules may import from the
integrations tree. Concrete adapters (`gmail`, `outlook`, `imap` — which includes SMTP submission) are reached only through
the provider registry, which is wired in composition roots. Adapters never import business modules.

## Database ownership

Each table has exactly one owning module (see `BACKEND_MODULES.md`). Other modules read or write
it only through the owner's use cases. Cross-module foreign keys are allowed at the schema level
(for integrity and cascade deletion) but are declared by table name, not by importing the model.

## Enforcement

`backend/tests/architecture/test_boundaries.py` parses every source file's imports and fails on:

- forbidden framework imports per layer,
- cross-module private imports,
- adapters importing business modules,
- import cycles between modules.
