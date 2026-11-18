# Responsive architecture

Mobile and desktop are equal targets. Styles are written mobile-first and widened. The desktop
layout follows `docs/design/SPARK_REFERENCE.md`; phones and tablets adapt the same elements.

## Layout modes

| Mode | Width | Shell |
|---|---|---|
| Phone | < 768px | Single pane. List header, bottom navigation, slide-out drawer for views and accounts. Thread opens as its own full-screen route. Composer is a full-screen sheet. Settings are full pages. |
| Tablet | 768–1023px | Icon rail (70px) + message list. Opening a thread replaces the list with the reader; ≥ 900px (`split`) shows list + reader side by side. Composer (new and reply) takes over the area right of the rail. Settings are a dialog. |
| Desktop | ≥ 1024px | Rail + list pane (348px) + reading pane. New message takes over list and reader; replies and forwards open as a docked panel in the reading pane. |
| Ultrawide | ≥ 1920px | Same three panes; list 400px, reading column capped at `52rem` and centred. Extra width becomes margin, never line length. |

Breakpoints are Tailwind defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536, plus the
custom `split` 900 and `3xl` 1920. Layouts must hold at every intermediate width.

## Navigation

- **Rail** (`md`+, the default): an "Expand menu" button, compose, the mail views (those the
  mailbox supports), "Accounts and folders", and at the bottom a language button (shows the
  current code, switches to the other language), a theme button (cycles system → light → dark)
  and settings. Icon buttons with tooltips; the open view is a solid
  accent square; an accent dot marks views with unread mail.
- **Flyout**: the "Accounts and folders" button opens the full navigation (views with unread
  counts, the mailbox's folders, account switcher, settings) as a 240px panel over the list pane.
  It is a modal Radix dialog without a backdrop: focus moves in and is trapped, Escape and a click
  outside close it, choosing a destination closes it, and focus returns to the button.
- **Pinned sidebar**: the rail's "Expand menu" button (or the same button in the flyout header)
  keeps the full navigation open in place of the rail; "Collapse menu" in its header returns to
  the rail. The full navigation (pinned, flyout and phone drawer) carries the segmented language
  and theme switches above Settings. Language and theme chosen here are saved to the account
  like in Settings → Appearance. Previously: the flyout's pin button kept the navigation open
  (240px). Stored in `localStorage` as `mf-sidebar` (`"false"` = pinned; anything else = rail).
- **Phone**: bottom navigation (inbox, starred, compose, search, settings) and the drawer with the
  same full navigation.

The width of the navigation column is the CSS variable `--nav-width` (0 / 70px / 240px, set in
`globals.css` from the breakpoint and `.mf-sidebar[data-pinned]`); `--nav-offset` adds the left
safe-area inset. Surfaces that sit beside the navigation (flyout, composer) are positioned with it.

## One route tree, adaptive presentation

`/mail/[view]` renders the list; `/mail/[view]/[threadId]` renders list + reader;
`/mail/search?q=` is the list pane in search mode; `/settings/*` are the settings sections. The
same routes serve every device:

- Phone: the list pane is hidden with CSS when a thread is open; the reader is hidden otherwise.
- Tablet/desktop: both panes are visible from `split`.
- Settings: full pages on phones; from `md` the same routes render as a modal dialog over the
  mail workspace. The settings layout renders `MailBackdrop` (the list the user last looked at
  and an empty reading pane, inert) behind the dialog, so a deep link, a reload or the OAuth
  return (`/settings/accounts?connected=…`) opens the dialog directly. Closing navigates to the
  last mail location (kept in memory, inbox by default).

Pane visibility and the settings dialog's geometry are pure CSS (`hidden md:flex`, `md:fixed …`),
so there is no hydration flash. `useMediaQuery` is used only where the *interaction* differs:
bottom sheet vs popover, docked vs full composer, and switching on the settings dialog's
behaviour (role, focus containment, Escape, inert background) once the width is known.

## Primitives

| Primitive | Behaviour |
|---|---|
| `AppShell` | `h-dvh` frame; owns rail / pinned sidebar / flyout / drawer / bottom-nav state, focus return, safe-area padding, `setNavigationInert` for modal surfaces |
| `Rail`, `SidebarContent` | Composition of the navigation (in `app/…/_shell`); `FolderNav` has a `rail` and a `full` variant |
| `MailWorkspace` / `MailBackdrop` | List + reader; the same as an inert background |
| `ResponsiveDialog` | Centred dialog ≥ 768px; bottom sheet below, scrollable, safe-area padded |
| `ResponsiveMenu` | Dropdown ≥ 768px; bottom sheet action list below |
| `Pane` | Flex column with `min-w-0 min-h-0` and its own scroll container |
| `EmailFrame` | Sandboxed iframe that auto-sizes height, scales wide content to fit and collapses trailing quoted history |
| `Tooltip` | Label for icon-only controls, optional key chip |

## Rules

- Height: `100dvh`, never bare `100vh`. Fixed bars add `env(safe-area-inset-*)` padding.
- Every flex/grid child that holds text gets `min-w-0`; long text uses `truncate` or
  `break-words` / `overflow-wrap: anywhere`.
- Touch targets ≥ 44×44 CSS px for primary controls on coarse pointers (`touch:` utilities).
- Nothing is hover-only. The quick actions that replace a row's avatar on hover also appear when
  the row holds keyboard focus, and the same actions are in the reader toolbar and its menu,
  which is how touch devices reach them. Tooltips repeat an accessible name, never add one.
- Inputs use `font-size: 16px` on phones to prevent iOS zoom.
- Composer uses the Visual Viewport API to keep the toolbar and Send above the virtual keyboard.
- Formatting controls are always visible in the composer (no selection-only toolbar).
- Email HTML cannot affect the page: it lives in an iframe; the frame is `width: 100%`, and
  content wider than the frame is scaled down (with a toggle to view at original size inside a
  horizontally scrollable region — the only intentional horizontal scroll).
- Modals lock or inert the background; popovers are collision-aware (Radix).

## Verification

`frontend/e2e/responsive.spec.ts` runs the key screens at the full viewport matrix
(320×568 … 2560×1440, both locales) asserting `scrollWidth <= clientWidth`, visibility of primary
actions, component geometry and minimum touch-target sizes, and stores screenshots for review.
`frontend/e2e/layout.spec.ts` covers the desktop behaviours (rail, flyout, date groups, quick
actions, docked reply, settings dialog). See `docs/development/RESPONSIVE_DEVELOPMENT.md`.
