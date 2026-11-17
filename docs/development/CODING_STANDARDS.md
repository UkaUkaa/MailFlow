# Coding standards

## Python

- Python 3.12, full type hints, `mypy --strict` clean, Ruff clean (rules in `pyproject.toml`).
- Layers: domain (pure), application (use cases + `Protocol` ports), infrastructure, presentation.
- Use cases get collaborators through `__init__`; no module-level state besides settings.
- Repositories for tenant data always take `user_id` and filter on it.
- Raise domain errors from `app.shared.domain.errors`; never raise `HTTPException` below
  presentation.
- Async I/O everywhere; no blocking calls in request handlers.
- Logging: `get_logger(__name__)`, event name + key/values. Never log secrets, tokens, cookies,
  bodies or attachment content.
- Small functions and files; a service class per cohesive use-case group.
- Comments explain *why* (a constraint, a security reason), not what the code does.

## TypeScript

- `strict` mode, no `any`, explicit return types on exported functions.
- Feature modules own components, hooks, API functions, Zod schemas and tests; import other
  features only through their `index.ts`.
- Server state through TanStack Query; `fetch` only inside `infrastructure/api-client`.
- No hardcoded user-facing strings; add keys to both `messages/en.json` and `messages/uk.json`.
- Semantic design tokens only; no raw colours or one-off spacing.
- Presentation components contain no data fetching or business rules.
- Every interactive element is keyboard reachable and has an accessible name.

## Configuration

Environment variables are read only in `backend/app/core/config`. New settings get a default (or
are required), a line in `.env.example` and a row in `docs/DOCKER.md`. Secrets never enter Git.

## Commits

Small, focused, imperative subject. Update docs and `CHANGELOG.md` in the same change.
