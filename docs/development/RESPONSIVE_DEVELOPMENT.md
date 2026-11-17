# Responsive development

Read `docs/architecture/RESPONSIVE_ARCHITECTURE.md` first. This page is the working checklist.

## Breakpoints in code

| Token | Width | Meaning |
|---|---|---|
| (base) | < 768px | Phone: single pane, bottom navigation, drawer, full-screen composer |
| `md:` | ≥ 768px | Sidebar rail appears, bottom navigation disappears, dialogs are centred |
| `split:` | ≥ 900px | List and reader side by side |
| `xl:` | ≥ 1280px | Full sidebar by default; wider list |
| `3xl:` | ≥ 1920px | Available for ultrawide tweaks; the reader is already capped at `max-w-3xl` |
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
- Never rely on hover. Hover shortcuts in thread rows are wrapped in `@media (hover: hover)` and
  duplicate actions that exist in the reader toolbar.
- Dialogs: `ResponsiveDialog` (bottom sheet on phones). Menus: `ResponsiveMenu`.
- Long labels: check Ukrainian. If three labelled buttons do not fit at 320px, keep one label and
  turn the others into icon buttons with `aria-label` (see `ReplyActions`).
- Email HTML only ever goes through `EmailFrame`.
- The composer sizes itself to `window.visualViewport` (`--vvh`, `--vvt`), so Send and the toolbar
  stay above the on-screen keyboard; the layout viewport also resizes
  (`interactive-widget=resizes-content`).

## Automated checks

`frontend/e2e/responsive.spec.ts` walks login → inbox → navigation → reader → composer →
connected accounts → action menu at:

- 320×568, 360×800, 375×812, 390×844, 414×896, 430×932, 600×900, 768×1024, 820×1180, 1024×768,
  1280×800, 1366×768, 1440×900, 1920×1080, 2560×1440 (English, light);
- 320, 390, 600, 768, 1024, 1440, 2560 widths again in Ukrainian with the dark theme;
- landscape 568×320, 812×375, 844×390, 932×430, 1180×820 (plus 844×390 in Ukrainian);
- the remaining screens (register, password flows, verify, search, empty folder, every settings
  section, the delete-account dialog) at five widths in both languages.

Assertions: `scrollWidth <= clientWidth` for the document and body, primary actions inside the
viewport, no overlap between row timestamp and star, rows not wrapping into tall blocks, 44px
touch targets on phones, list not hidden behind the bottom navigation, sidebar width per mode
(56px rail / 240px full), reader column ≤ 768px, email content scaled to its frame, composer full
screen on phones and still showing Send and the toolbar when the viewport height shrinks
(keyboard stand-in). Fixtures deliberately contain a 90-character email address, a 150-character
subject, an unbreakable 80-character token, Ukrainian content and a 900px-wide HTML table.

`frontend/e2e/mobile.spec.ts` covers the touch flows (bottom navigation, drawer, single-pane
reader, bottom-sheet menus, composer).

Screenshots are written to `frontend/e2e/screenshots/<width>x<height>/<locale>-<theme>-<n>-<screen>.png`
(git-ignored).

## Manual review (required for UI changes)

1. `pnpm build && pnpm e2e` in `frontend/`.
2. Open the screenshots for at least 320×568, 390×844, 768×1024, 1024×768, 1440×900 and
   2560×1440, in both `en-light` and `uk-dark`.
3. Look for: clipped or truncated button labels, one-word-per-line wrapping, uneven spacing,
   content touching screen edges, controls under the bottom bar, unreadable contrast in dark mode.
4. Fix, rerun, look again.

What automation cannot cover and must be checked on real devices before a release: the iOS and
Android on-screen keyboards with the composer, safe-area insets on notched phones, and momentum
scrolling inside the reader.
