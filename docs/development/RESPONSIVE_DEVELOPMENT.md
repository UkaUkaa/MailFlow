# Responsive development

Read `docs/architecture/RESPONSIVE_ARCHITECTURE.md` first. This page is the working checklist.

## Breakpoints in code

| Token | Width | Meaning |
|---|---|---|
| (base) | < 768px | Phone: single pane, bottom navigation, drawer, full-screen composer |
| `md:` | ≥ 768px | Navigation rail appears, bottom navigation disappears, dialogs are centred, composer becomes a page beside the rail, settings become a dialog |
| `split:` | ≥ 900px | List and reader side by side |
| `lg:` | ≥ 1024px | Replies open as a docked panel (decided with `useMediaQuery`) |
| `3xl:` | ≥ 1920px | Wider list pane; the reading column is already capped at `max-w-[52rem]` |
| `touch:` | coarse pointer **or** < 768px | 44px controls, 16px inputs |

`split` and `3xl` are defined in `@theme` in `globals.css`; `touch` is a custom variant there.

## Rules of thumb

- Write the phone layout first, then add `md:` / `split:` / `xl:` classes.
- Switch layouts with CSS. `useIsPhone()` is only for interaction differences
  (`ResponsiveMenu`: dropdown vs bottom sheet).
- Every flex or grid child that contains text needs `min-w-0`; then choose `truncate` (single
  line: senders, subjects in lists) or `break-words` (headings, descriptions, addresses).
- Full-height containers use `h-dvh` / `min-h-dvh`. Fixed bars use `pt-safe` / `pb-safe` /
  `px-safe` or `max(…, env(safe-area-inset-*))`.
- Interactive controls: use `Button` sizes (`md`, `sm`, `icon` grow to 44px under `touch:`); for
  custom controls add `touch:size-11` / `touch:h-11`.
- Never rely on hover. Hover shortcuts in thread rows are wrapped in `@media (hover: hover)`,
  also appear on keyboard focus, and duplicate actions that exist in the reader toolbar.
- Do not reveal focusable controls with `display: none` + `:focus-within` / `:has(:focus-visible)`.
  While focus moves between two controls nothing is focused, the rule hides the target and the
  browser drops the focus. Track focus in state (`ThreadRow`) or hide with opacity.
- Position anything that sits beside the navigation with `var(--nav-offset)`, never a fixed 70px:
  the navigation can be expanded (240px), and the variable animates.
- Navigation items are rows built from `nav-row.ts` (icon cell + label). Do not add a control
  that exists in only one state above or between shared rows: it would move them.
- A Radix dialog opened without a `Dialog.Trigger` does not return focus by itself: handle
  `onCloseAutoFocus` (see `AppShell`).
- Dialogs: `ResponsiveDialog` (bottom sheet on phones). Menus: `ResponsiveMenu`.
- Long labels: check Ukrainian. If three labelled buttons do not fit at 320px, keep one label and
  turn the others into icon buttons with `aria-label` (see `ReplyActions`).
- Email HTML only ever goes through `EmailFrame`.
- The composer sizes itself to `window.visualViewport` (`--vvh`, `--vvt`), so Send and the toolbar
  stay above the on-screen keyboard; the layout viewport also resizes
  (`interactive-widget=resizes-content`).

## Automated checks

`frontend/e2e/responsive.spec.ts` walks login → inbox → navigation (drawer / rail expanded in place) →
reader → reply → composer → search → search results → connected accounts → action menu at:

- 320×568, 360×800, 375×812, 390×844, 414×896, 430×932, 600×900, 768×1024, 820×1180, 1024×768,
  1280×800, 1366×768, 1440×900, 1920×1080, 2560×1440 (English, light);
- 320, 390, 600, 768, 1024, 1440, 2560 widths again in Ukrainian with the dark theme;
- landscape 568×320, 812×375, 844×390, 932×430, 1180×820 (plus 844×390 in Ukrainian);
- the remaining screens (register, password flows, verify, search, empty folder, every settings
  section, the delete-account dialog) at five widths in both languages.

Assertions: `scrollWidth <= clientWidth` for the document and body, primary actions inside the
viewport, no overlap between row timestamp and star, rows not wrapping into tall blocks, 44px
touch targets on phones, list not hidden behind the bottom navigation, 88px three-line rows with
a 28px avatar and a date heading, 70px rail that expands to 240px without moving its toggle or its settings row and keeps
focus on the toggle, message cards (12px radius, 12px inset), collapsed quote toggle, reader column
≤ 768px, email content scaled to its frame, reply docked at 520×≤380 from 1024px and filling the
workspace below, composer full screen on phones / beside the rail from 768px with a 22px subject
and still showing Send and the toolbar when the viewport height shrinks (keyboard stand-in),
search field focused with honest suggestions, settings as a ≤ 870×700 dialog from 768px and as
pages on phones. The clock is pinned to the fixtures' date so the date groups are stable. Fixtures deliberately contain a 90-character email address, a 150-character
subject, an unbreakable 80-character token, Ukrainian content and a 900px-wide HTML table.

`frontend/e2e/mobile.spec.ts` covers the touch flows (bottom navigation, drawer, single-pane
reader, bottom-sheet menus, composer). `frontend/e2e/layout.spec.ts` covers the desktop
behaviours: tonal surfaces, rail states and tooltips, the collapsed ↔ expanded navigation (every icon keeps its position,
labels and counts, animation, reduced motion, no flash on reload, keyboard), date
groups per locale and time zone, row quick actions by pointer and keyboard, the reader pill and
quote toggle, the docked reply, and the settings dialog (deep links, focus containment, nested
dialogs, phone pages).

Screenshots are written to `frontend/e2e/screenshots/<width>x<height>/<locale>-<theme>-<n>-<screen>.png`
(git-ignored).

## Manual review (required for UI changes)

1. `pnpm build && pnpm e2e` in `frontend/`.
2. Open the screenshots for at least 320×568, 390×844, 768×1024, 820×1180, 1024×768, 1440×900
   and 2560×1440, in both `en-light` and `uk-dark`. (Delete `.next` first if `globals.css`
   changed.)
3. Look for: clipped or truncated button labels, one-word-per-line wrapping, uneven spacing,
   content touching screen edges, controls under the bottom bar, unreadable contrast in dark mode.
4. Fix, rerun, look again.

What automation cannot cover and must be checked on real devices before a release: the iOS and
Android on-screen keyboards with the composer, safe-area insets on notched phones, and momentum
scrolling inside the reader.
