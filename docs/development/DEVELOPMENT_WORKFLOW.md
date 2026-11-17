# Development workflow

## Start of a session

1. Read `AGENTS.md`, `CLAUDE.md`, `README.md`.
2. Read the docs for the area you will touch.
3. `git status`, `git log --oneline -15`.
4. Check `docs/architecture/IMPLEMENTATION_CHECKLIST.md` and `docs/LIMITATIONS.md` for open work.

## Making a change

1. Plan: modules affected, schema, API, security (who owns the data, how is it authorized),
   responsive impact, tests.
2. Backend order: domain → application (ports) → infrastructure → presentation → wiring in
   `app/bootstrap.py` → tests.
3. Schema change: edit models, `alembic revision --autogenerate`, review the migration by hand,
   add RLS/grants for new tenant tables, update `docs/DATABASE.md`.
4. API change: update `docs/API.md` first; keep backend and frontend in step.
5. Frontend: build mobile-first, add both locales, verify at phone/tablet/desktop in both themes.
6. Run the checks in `TESTING.md`.

## End of a session

Update docs, `CHANGELOG.md`, `docs/DECISIONS.md`, `docs/LIMITATIONS.md` and the checklist. Report
what was done, what was run with real results, and what is unfinished.

## Running locally

See `README.md`. Useful URLs in development: API docs `http://localhost:8000/api/docs`, mail
catcher `http://127.0.0.1:18025` (dev stack) or `http://127.0.0.1:8025` (full stack).
