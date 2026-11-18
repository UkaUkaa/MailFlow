# CLAUDE.md

@AGENTS.md

`AGENTS.md` (imported above) is the source of truth for *what* is required. This file sets *when*
Claude does each step, so small tasks stay cheap. Rules scale with the size of the change.

## Context: read only what the task touches

- Do not read docs up front. Open a doc only when the change touches its area:
  - auth, sessions, tokens, tenancy, email HTML, SSRF → `docs/SECURITY.md`, `docs/architecture/DATA_OWNERSHIP.md`
  - new module, cross-module import, schema change → `docs/architecture/MODULE_BOUNDARIES.md`
  - API contract → `docs/API.md`
  - provider / sync → `docs/EMAIL_INTEGRATION.md`, `docs/architecture/PROVIDER_ARCHITECTURE.md`
  - layout / breakpoints → `docs/architecture/RESPONSIVE_ARCHITECTURE.md`
- Read the section you need (grep, line ranges), not the whole file.
- Locate code with targeted grep/glob. Do not read whole directories.
- `git status` / `git log --oneline -5` are enough to orient; no full diffs unless needed.
- Do not spawn subagents for tasks you can do in a few tool calls.

## Verification: scale to the change

Iterating on a change:
- Backend: run only the affected tests (`uv run pytest tests/path -q`), `ruff`/`mypy` on changed files.
- Frontend: `pnpm test <file>`, `pnpm typecheck`. No `pnpm e2e` per iteration.
- UI: one check (phone or desktop, light theme, `en`) via `read_page`/`get_page_text`;
  screenshots only when layout itself is in question.
- Use quiet flags (`-q`, `--reporter=dot`) and show only failing output (`| tail -30`).

Before commit / PR (the "done" gate from `AGENTS.md`):
- Full suites: `cd backend && uv run pytest -q && uv run ruff check . && uv run mypy app`,
  `cd frontend && pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`.
  `pnpm e2e` already covers the viewport matrix — prefer it over manual screenshots.
- Manual phone / tablet / desktop × both themes × both locales only for visible layout changes
  not covered by e2e.
- Architecture tests must pass.

## Docs: once, at the end

- Update `CHANGELOG.md` and affected docs once, before the commit, not after every edit.
- `docs/DECISIONS.md` only for real decisions; `docs/LIMITATIONS.md` only for new gaps;
  `docs/architecture/IMPLEMENTATION_CHECKLIST.md` only when a checklist item changes state.
- Append to these files; do not re-read them in full.

## Always

- Follow existing conventions; preserve module boundaries.
- Report incomplete work honestly. Never claim a test passed without running it.
