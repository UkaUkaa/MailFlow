# Responsive architecture

Mobile and desktop are equal targets. Styles are written mobile-first and widened. The desktop
layout follows `docs/design/SPARK_REFERENCE.md`; phones and tablets adapt the same elements.

## Layout modes

| Mode | Width | Shell |
|---|---|---|
| Phone | < 768px | Single pane. List header, bottom navigation, slide-out drawer for views and accounts. Thread opens as its own full-screen route. Composer is a full-screen sheet. Settings are full pages. |
| Tablet | 768–1023px | Navigation column (70px rail, expandable to 240px) + message list. Opening a thread replaces the list with the reader; ≥ 900px (`split`) shows list + reader side by side. Composer (new and reply) takes over the area right of the rail. Settings are a dialog. |
| Desktop | ≥ 1024px | Navigation column + list pane (348px) + reading pane. New message takes over list and reader; replies and forwards open as a docked panel in the reading pane. |
| Ultrawide | ≥ 1920px | Same three panes; list 400px, reading column capped at `52rem` and centred. Extra width becomes margin, never line length. |

Breakpoints are Tailwind defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536, plus the
custom `split` 900 and `3xl` 1920. Layouts must hold at every intermediate width.

## Navigation

From 768px there is **one navigation column** (`aside.mf-sidebar`, component `Navigation` in
`app/…/_shell`) with two states of the same layout:

- **Collapsed** (default): the 70px icon rail.
- **Expanded**: 240px, the same rows with their labels visible.

Every item is a row (`shared/components/layout/nav-row.ts`): a fixed 28px icon cell whose centre
sits on the rail's axis (35px), followed by a label. Rows have fixed side margins, so their width
follows the column; the label is clipped by the row and faded. Expanding therefore changes only
the column's width and reveals text. Order, top to bottom, identical in both states:

1. the toggle (`PanelLeftOpen` "Expand menu" ↔ `PanelLeftClose` "Collapse menu", `aria-expanded`),
   with the brand beside it when expanded;
2. compose;
3. the mail views the mailbox supports (unread as a dot when collapsed, as a count when expanded);
4. accounts: "All accounts" and one row per mailbox (its colour dot is the icon), under a heading
   that is a hairline when collapsed;
5. expanded only, below everything shared: the selected mailbox's own folders;
6. at the bottom: language (current code / "Language: English"), theme (current icon /
   "Theme: System"), settings. A click switches the language or moves to the next theme and
   saves it to the account, as Settings → Appearance does.

Rows 3–5 scroll when the window is short; the top and bottom blocks do not move.

- Tooltips exist only while collapsed (`Tooltip disabled`), accessible names are the same in both
  states, and focus stays on the toggle when it is used.
- The state is stored in `localStorage` as `mf-sidebar` (`"false"` = expanded; anything else =
  collapsed) and mirrored on `<html data-nav>`. An inline script (`navInitScript`) sets the
  attribute before first paint, so a stored "expanded" never flashes as the rail.
- The width is the CSS variable `--nav-width` (0 / 70px / 240px, set in `globals.css` from the
  breakpoint and `html[data-nav]`); `--nav-offset` adds the left safe-area inset. The variable is
  registered with `@property` and transitioned on `:root` (180ms ease-out, enabled after
  hydration by `data-nav-ready`), so the column and everything positioned with it (the composer)
  move together. `prefers-reduced-motion` switches the transition off.
- **Phone**: bottom navigation (inbox, starred, compose, search, settings) and a drawer that
  renders the same `Navigation` rows, always expanded, closing when a destination is chosen.

There is no separate flyout: expanding in place made it redundant (D35).

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
| `AppShell` | `h-dvh` frame; owns the navigation column's state (collapsed / expanded), the phone drawer and its focus return, safe-area padding, `setNavigationInert` for modal surfaces |
| `Navigation`, `nav-row` | The one navigation layout (in `app/…/_shell`) and its row classes (in `shared/components/layout`); `FolderNav`, `AccountSwitcher` and `QuickPreferences` render rows |
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
`frontend/e2e/layout.spec.ts` covers the desktop behaviours (navigation column, date groups, quick
actions, docked reply, settings dialog). See `docs/development/RESPONSIVE_DEVELOPMENT.md`.
