# Responsive architecture

Mobile and desktop are equal targets. Styles are written mobile-first and widened.

## Layout modes

| Mode | Width | Shell |
|---|---|---|
| Phone | < 768px | Single pane. Top app bar, bottom navigation, slide-out drawer for accounts and folders. Thread opens as its own full-screen route. Composer is full-screen. |
| Tablet | 768–1023px | Icon rail (expandable to drawer) + message list. Opening a thread replaces the list with the reader in portrait; ≥ 900px wide shows list + reader side by side. |
| Laptop | 1024–1279px | Collapsible sidebar (rail by default) + list (320–360px) + reader. |
| Desktop | ≥ 1280px | Full sidebar (240px) + list (clamp 340–420px) + reader. |
| Ultrawide | ≥ 1920px | Same three panes; list capped, reader content capped at `72ch`/`48rem` and centred. Extra width becomes margin, never line length. |

Breakpoints are Tailwind defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536, plus a
custom `3xl` 1920. They are chosen by content, and layouts must hold at every intermediate width.

## One route tree, adaptive presentation

`/mail/[view]` renders the list; `/mail/[view]/[threadId]` renders list + reader. The same routes
serve every device:

- Phone: the list pane is hidden with CSS when a thread is open; the reader is hidden otherwise.
- Tablet/desktop: both panes are visible.

Pane visibility is pure CSS (`hidden md:flex` etc.), so there is no hydration flash and no
JavaScript viewport sniffing for layout. Data hooks are shared; only presentation differs.
`useMediaQuery` is used only where the *interaction* differs (bottom sheet vs popover, full-screen
vs floating composer).

## Primitives

| Primitive | Behaviour |
|---|---|
| `AppShell` | `h-dvh` grid; owns sidebar/rail/bottom-nav switching and safe-area padding |
| `ResponsiveDialog` | Centred dialog ≥ 768px; bottom sheet below, scrollable, safe-area padded |
| `ResponsiveMenu` | Dropdown ≥ 768px; bottom sheet action list below |
| `Pane` | Flex column with `min-w-0 min-h-0` and its own scroll container |
| `EmailFrame` | Sandboxed iframe that auto-sizes height and scales wide content to fit |

## Rules

- Height: `100dvh`, never bare `100vh`. Fixed bars add `env(safe-area-inset-*)` padding.
- Every flex/grid child that holds text gets `min-w-0`; long text uses `truncate` or
  `break-words` / `overflow-wrap: anywhere`.
- Touch targets ≥ 44×44 CSS px for primary controls on coarse pointers (`size-11` utilities).
- Nothing is hover-only. Row actions that appear on hover on desktop are also in the reader
  toolbar and in the row's long-press / overflow menu.
- Inputs use `font-size: 16px` on phones to prevent iOS zoom.
- Composer uses the Visual Viewport API to keep the toolbar and Send above the virtual keyboard.
- Email HTML cannot affect the page: it lives in an iframe; the frame is `width: 100%`, and
  content wider than the frame is scaled down (with a toggle to view at original size inside a
  horizontally scrollable region — the only intentional horizontal scroll).
- Modals lock background scroll; popovers are collision-aware (Radix).

## Verification

`frontend/e2e/responsive.spec.ts` runs the key screens at the full viewport matrix
(320×568 … 2560×1440, both locales) asserting `scrollWidth <= clientWidth`, visibility of primary
actions and minimum touch-target sizes, and stores screenshots for review. See
`docs/development/RESPONSIVE_DEVELOPMENT.md`.
