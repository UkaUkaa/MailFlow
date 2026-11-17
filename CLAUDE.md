# CLAUDE.md

1. Read `AGENTS.md` first. It is the source of truth.
2. Read the docs relevant to the task (`docs/architecture/*`, `docs/SECURITY.md`, `docs/API.md`).
3. Inspect the repository and `git status` / `git log` before changing anything.
4. Follow existing conventions; do not introduce parallel patterns.
5. Preserve module boundaries (`docs/architecture/MODULE_BOUNDARIES.md`). Architecture tests must pass.
6. Follow the responsive standards (`docs/architecture/RESPONSIVE_ARCHITECTURE.md`): every UI change
   is checked on phone, tablet and desktop, in both themes and both locales.
7. Run the relevant tests:
   - `cd backend && uv run pytest && uv run ruff check . && uv run mypy app`
   - `cd frontend && pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`
8. Update documentation and `CHANGELOG.md` alongside the code.
9. Record significant decisions in `docs/DECISIONS.md` and gaps in `docs/LIMITATIONS.md`.
10. Report incomplete work honestly. Never fabricate test results.

Progress tracking lives in `docs/architecture/IMPLEMENTATION_CHECKLIST.md`.
