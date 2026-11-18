# Frontend

Next.js 16 (App Router, Turbopack), React 19, strict TypeScript, Tailwind CSS 4, Radix primitives
with shadcn-style wrappers, TanStack Query 5, React Hook Form + Zod 4, next-intl 4, Tiptap 3,
Lucide, Sonner. Package manager: pnpm.

Structure and dependency rules: `docs/architecture/FRONTEND_MODULES.md`,
`docs/architecture/DEPENDENCY_RULES.md`. Layout: `docs/architecture/RESPONSIVE_ARCHITECTURE.md`.
Tokens: `docs/architecture/DESIGN_SYSTEM.md` (implemented in `frontend/src/app/globals.css`).

## Commands (run in `frontend/`)

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server on :3000. `/api/*` is rewritten to `BACKEND_INTERNAL_URL` (default `http://localhost:8000`). |
| `pnpm lint` | ESLint (Next core-web-vitals + TypeScript + React Compiler rules) |
| `pnpm typecheck` | `next typegen` + `tsc --noEmit` |
| `pnpm test` | Vitest + React Testing Library (`src/**/*.test.ts(x)`) |
| `pnpm build` | Production build, `output: "standalone"` |
| `pnpm e2e` | Playwright against the standalone build (run `pnpm build` first). API is mocked from `e2e/fixtures`. |

## Next.js 16 specifics

- Request interception lives in `src/proxy.ts` (the former `middleware.ts`); it only runs the
  next-intl locale routing and skips `/api`, `/_next` and files.
- `params` are Promises in server components; client components use `useParams`.
- `cacheComponents` / `partialPrefetching` are **not** enabled: the app is an authenticated,
  client-data application and next-intl's request APIs are simpler without them.
- The root layout is `src/app/[locale]/layout.tsx` (there is no `src/app/layout.tsx`).
- `BACKEND_INTERNAL_URL` is read when `next.config.ts` is evaluated at **build** time (rewrites
  are baked into the standalone server). The Dockerfile exposes it as a build argument.
- Never render extra elements inside `<head>` from a layout. The theme bootstrap script is the
  first node of `<body>`: React and Next own `<head>`, and an extra child there fails hydration
  (React error #418) when the HTML arrives in one piece, as it does behind nginx.
  `e2e/hydration.spec.ts` delivers documents buffered and fails on any React/hydration error.
- `next start` does not serve a standalone build; `scripts/start-standalone.mjs` does what the
  Docker image does and is what Playwright uses.

## Where things live

- `src/app/[locale]/(auth)` — login, register, verify-email, forgot-password, reset-password.
- `src/app/[locale]/(application)` — `mail/[view]`, `mail/[view]/[threadId]`, `settings/*`.
  `_shell/` is the composition root of the signed-in frame (`Navigation`, `QuickPreferences`,
  `BottomNav`). `settings/layout.tsx` composes the settings dialog with `MailBackdrop`.
- Search is the mail view `search` (`/mail/search?q=`), not a separate route tree: the list pane
  switches to its search mode and results reuse the list rows and the reader.
- `src/infrastructure/api-client` — the only code that calls `fetch`.
- `src/infrastructure/authentication` — `useSession`, `SessionGuard`, `replaceSession`.
- `src/shared/components/layout` — `AppShell`, `Pane`, `ResponsiveDialog`, `ResponsiveMenu`.
- `src/shared/utils/date-groups.ts` — date headings of the list; `src/shared/lib/mail-location.ts`
  — the last mail location (in memory), used to leave search and to close settings.

## API client

`api.get/post/put/patch/delete(path, zodSchema, body?, options?)`:

- every response is validated with a Zod schema; a mismatch throws `ApiError("invalid_response")`;
- state-changing calls send `X-CSRF-Token` from the `mf_csrf` cookie, fetching
  `GET /auth/csrf` first when the cookie is missing, and retry once after `403 csrf_failed`;
- the error envelope becomes `ApiError { status, code, message, details, retryAfter }`;
  `errorKey(error)` maps it to a key in the `errors` message namespace;
- a `401` calls the handler registered by `SessionGuard`, which marks the session as signed out,
  removes every cached query and redirects to `/login?next=…`. Calls that are expected to return
  401 (`/auth/me` probe, login) pass `skipAuthRedirect`.

Nothing sensitive is stored in the browser: the session cookie is HttpOnly, and `localStorage`
only holds the theme (`mf-theme`) and navigation (`mf-sidebar`, expanded or collapsed) preferences. Recent
search queries are kept in memory for the tab and never written to storage.

## Server state

TanStack Query keys: `["session"]`, `["settings"]`, `["accounts", …]`, `["folders", …]`,
`["threads", "list", filter]`, `["threads", "detail", id]`, `["auth", "sessions"]`.
Thread actions are optimistic (`modules/emails/lib/optimistic.ts`) with rollback; archive, trash
and spam show an undo toast that sends the inverse action. On sign-in/out `replaceSession`
updates the session query in place and drops everything else, so one user's data can never be
shown to the next.

## Mail workspace

Layout, sizes and states: `docs/architecture/DESIGN_SYSTEM.md` and
`docs/architecture/RESPONSIVE_ARCHITECTURE.md`. What each part does:

- **Navigation** — `AppShell` renders one navigation column and holds its state (collapsed
  rail / expanded menu) and the phone drawer. `Navigation` is the single layout for all three;
  `FolderNav`, `AccountSwitcher`, `CustomFolderNav` and `QuickPreferences` render its rows from
  the classes in `shared/components/layout/nav-row.ts`. Details: RESPONSIVE_ARCHITECTURE.
- The root layout renders two inline scripts as the first nodes of `<body>`: the theme script
  and `navInitScript`. They are separate tags on purpose: `themeInitScript` is exported from a
  client module, and concatenating it on the server yields an error stub instead of the script.
- **Thread list** (`modules/inbox`) — header (title, account scope, unread filter, sync, search,
  new message; a back button in a custom folder), then rows under date headings. Headings come
  from `dateGroup()` (`Today`, `Yesterday`, `This week`, `Last week`, month, month + year),
  computed in the browser's time zone with the locale's first day of the week
  (`Intl.Locale#getWeekInfo`, Monday as fallback); search results are not grouped. A heading is a
  presentational `<li>` inside the one list, so the list keeps a single accessible name and
  infinite scrolling is unchanged. Rows show an unread dot, a 28px avatar (initials on a colour
  derived from the address), sender / date, subject + message-count chip + attachment mark, one
  preview line, and the star. Quick actions (read/unread, archive when the mailbox supports it,
  trash) take the avatar's place on hover and on keyboard focus and call the same optimistic
  actions as the reader. Every row is washed with its mailbox colour (`.account-tint`, see
  DESIGN_SYSTEM.md); the mailbox picture, when set, replaces the colour dot.
- **Account appearance** (`modules/accounts`, Settings → Connected accounts → Edit) — presets,
  any RGB colour (`<input type="color">`) and a hex field, plus a picture (PNG/JPEG/WebP). The
  picture is cropped to a centred square and re-encoded to 96×96 WebP (PNG where WebP encoding is
  unavailable) in the browser (`lib/avatar.ts`); its average colour is offered as the account
  colour. A preview row shows the wash before saving.
- **Reader** (`modules/emails`) — toolbar: a two-segment pill (back to the list; archive, only
  when `isActionAvailable("archive")`), then trash, mark unread, star, spam (tablet and wider) and
  the "More actions" menu. Each message is a card; a stored draft in a conversation is a compact
  card with Edit and Delete (no Send: see `docs/LIMITATIONS.md`). Card footers hold reply /
  reply all / forward; phones use the bar under the conversation and the card menu instead.
- **Search** (`modules/search`) — `SearchBox` (Escape returns to the previous list) and
  `SearchSuggestions`: this tab's recent queries and a description of what is searched. The
  server does a plain full-text prefix search, so no `from:` / `has:` operators are suggested.
- **Settings** (`modules/settings`) — `SettingsLayout` is full pages on phones and a modal dialog
  from 768px; every section stays a route.
- **Interface preferences** (`settings/interface`) — stored with the other settings;
  `SettingsSync` mirrors them on `<html>` (`shared/lib/interface-preferences.ts`) on every change,
  and `interfaceInitScript` restores the last values from `localStorage` (`mf-interface`) before
  first paint. Components react through CSS variants (see DESIGN_SYSTEM.md); the email frame,
  which CSS cannot reach, reads the accent and text size with `useRootDataset`.

## Email rendering

`modules/emails/components/email-frame.tsx` renders the server-sanitized HTML in an iframe:

- `sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"` — no scripts, forms
  or top navigation. Same-origin is needed only so the parent can measure the content height.
- The `srcdoc` carries its own CSP: `default-src 'none'`, inline styles only, images restricted
  to `data:`/`cid:` unless the user clicks "Show images" or enabled the global setting.
- When images are not allowed, remote `src`/`srcset`/`poster`/`background` values are also
  removed from the markup before it is rendered.
- Links get `target="_blank" rel="noopener noreferrer nofollow"`.
- The frame is always as wide as the reading column. Tables wider than the frame are scaled down
  individually so text keeps its size; "View at original size" switches to a horizontally
  scrollable region. Emails without colour declarations follow the app theme; styled emails are
  shown on a light surface in both themes.
- Quoted history: `markQuotedHistory()` (in `lib/email-document.ts`) marks `blockquote` blocks
  that close a message which also has text of its own; the document's own style sheet hides
  marked blocks until the user presses the "•••" toggle under the frame. Inline replies and
  messages that are only a quote are left alone. Only an attribute and one CSS rule are added:
  the sandbox attribute and the CSP are unchanged. The server sanitizer keeps no `class`
  attributes, so provider-specific markers (`gmail_quote`) are matched only if they survive.

## Composer

`ComposerProvider` exposes `compose()`, `reply(message, mode)` and `editDraft(id)`; the panel and
Tiptap are loaded on first use. One form has three presentations: a full-screen sheet on phones;
from 768px a document-like page that takes over the list and reading panes (subject as a 22px
title, one "To, Cc, Bcc" line that opens into three fields when it gets focus, borderless body,
close / attach / discard / From / Send in the top bar, formatting bar at the bottom); and, for
replies and forwards from 1024px, a 520×380 panel docked at the bottom right of the reading pane
with Expand (to the page) and Dock (back). Escape saves and closes from anywhere in the form,
Ctrl/⌘ Enter sends. One compose session has one UUID that is sent as
`Idempotency-Key`, so retries and double clicks cannot send twice. Drafts are saved through the
drafts endpoints 1.5 s after the last change (saves are serialized) and when the composer is
closed; attachments stay in the browser until send. The quoted original is kept outside the
editor (so its markup survives) and appended to `body_html` on save and send.

## IMAP/SMTP mailboxes

Settings → Connected accounts offers "Connect another mail account (IMAP)" when
`GET /accounts/providers` reports `imap` as available (otherwise a note says the server does not
offer it). Everything lives in `modules/accounts`:

- `lib/imap.ts` — the Zod schema (`imapConnectSchema`), defaults (IMAP 993 + SSL/TLS, SMTP 587 +
  STARTTLS), the allowed ports (IMAP 993/143, SMTP 587/465, offered as selects),
  `portAfterSecurityChange` (a default port follows the encryption; a port picked against the
  default is kept), `toImapConnectPayload` (exactly the body of `POST /accounts/imap`) and
  `describeImapError`, which maps `authentication_failed`, `tls_required`, `connection_failed`,
  `blocked_destination` (naming the IMAP or SMTP server when `details` says which one failed),
  `validation_error`, `account_limit_reached`, `rate_limited` (with the `Retry-After` wait) and
  `not_found` to keys under `accounts.imap.errors`.
- `components/imap-connect-dialog.tsx` — React Hook Form + Zod inside `ResponsiveDialog`. The
  username follows the email address until it is edited. The actions are part of the scrolling
  form, so on a short viewport (open keyboard) every field and the submit button stay reachable.
- `components/imap-reconnect-dialog.tsx` — asks only for the password and calls
  `POST /accounts/{id}/imap/credentials`. `connected-accounts.tsx` opens it for accounts whose
  provider is a password provider (`isPasswordProvider`, i.e. `imap`), from both the
  "Reconnect required" banner and the actions menu; OAuth accounts keep the redirect through
  `POST /accounts/{id}/reconnect`, which is never called for IMAP.

The mailbox password exists only in the form state of the open dialog: the inputs are
`type="password"` with `autoComplete="new-password"`, the requests are plain `api.post` calls (not
TanStack mutations, which would keep their variables in the mutation cache), and the form is reset
on success and on every way of closing. On success the returned account is put into
`["accounts", "list"]` and the accounts, sync, thread and folder queries are invalidated.

## Capability-driven actions

`Account.capabilities` is per account: an IMAP mailbox without an Archive, Junk or Drafts folder
reports `archive`, `spam` or `drafts` as `false`. Controls for an unsupported action are left out
instead of being offered and rejected with `422 unsupported`:

- `modules/accounts/lib/capabilities.ts` — `accountsSupport(accounts, accountIds, capability)` is
  true only when **every** given mailbox supports the capability (the rule for anything that acts
  on several threads); an unknown or not yet loaded mailbox counts as unsupported.
- `modules/emails/lib/capabilities.ts` — `ACTION_CAPABILITY` ties `archive`/`unarchive` to
  `archive` and `spam`/`not_spam` to `spam`; `isActionAvailable(action, accounts, accountIds)`
  is what the UI asks. The reader toolbar and its "More actions" menu, and the hover shortcut of a
  list row, use it. Trash, star and read state work on every mailbox.
- `FolderNav` hides the Drafts, Archive and Spam views when the selected mailbox lacks the
  folder (in the unified view: when no mailbox has it); the open view is never hidden.
- The composer does not autosave for a mailbox with `drafts: false`. It says so in a note, and
  closing a message with content asks whether to discard it instead of trying to save.

## Known gaps

- Draft attachments are not persisted (matches decision D9); reopening a saved draft loads the
  quoted text into the editor, which simplifies complex quoted markup.
- No offline support, keyboard-shortcut layer, bulk selection or swipe gestures yet.
- Pin, snooze, assign, share, AI, calendar, priority and smart category cards of the reference
  are not present: MailFlow has no such features (D31).
- After changing `globals.css`, delete `.next` before `pnpm build`: the Turbopack cache has
  served a stale theme to the Tailwind loader.
- Gmail and Outlook are offered from `/accounts/providers`; a provider the server has not
  configured is shown as "not configured" instead of a button.
- An IMAP mailbox's servers, ports and username cannot be edited after connecting; connecting the
  same address again replaces them.
- The search box is shown for every mailbox; `server_search`, `threads` and `labels` do not change
  the interface.
