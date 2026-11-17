# Design system

Original identity: quiet, typographic, neutral surfaces with a single ink-blue accent. No
gradients, no emoji, minimal shadow, restrained motion.

Tokens live in `frontend/src/app/globals.css` as CSS variables and are exposed to Tailwind through
`@theme`. Components use semantic tokens only — never raw hex values.

## Colour tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#ffffff` | `#0c0d0f` | App canvas, reader |
| `--surface` | `#f7f7f8` | `#121316` | Sidebar, list pane |
| `--surface-raised` | `#ffffff` | `#191b1f` | Cards, dialogs, sheets |
| `--muted` | `#f0f0f2` | `#1e2025` | Hover, chips, skeletons |
| `--border` | `#e6e6ea` | `#26282e` | Hairlines |
| `--border-strong` | `#d2d2d9` | `#363941` | Inputs |
| `--foreground` | `#17181c` | `#ededf0` | Primary text |
| `--foreground-muted` | `#5d5f6b` | `#a0a3ad` | Secondary text |
| `--foreground-subtle` | `#8a8c98` | `#737682` | Tertiary text, placeholders |
| `--accent` | `#3355e0` | `#7d95ff` | Primary action, unread marker, focus |
| `--accent-foreground` | `#ffffff` | `#0c0d0f` | Text on accent |
| `--accent-soft` | `#eef1fd` | `#1a2040` | Selected row, soft buttons |
| `--danger` | `#c93a3a` | `#f07070` | Destructive |
| `--success` | `#1f8a4c` | `#4cc38a` | Success |
| `--warning` | `#a86a00` | `#e0a83a` | Attention |

Text/background pairs meet WCAG AA (4.5:1 body, 3:1 large/UI).

Account colours (identification dots): a fixed set of eight hues, chosen per account.

## Typography

Font: Inter (variable, self-hosted via `next/font`) with system fallbacks; it covers Cyrillic.
Monospace: `ui-monospace` stack.

| Token | Size / line height | Use |
|---|---|---|
| `text-xs` | 12 / 16 | Meta, timestamps |
| `text-sm` | 14 / 20 | Dense UI, list rows (desktop) |
| `text-base` | 16 / 24 | Body, inputs on phones, reader |
| `text-lg` | 18 / 26 | Section titles |
| `text-xl` | 20 / 28 | Page titles (phone) |
| `text-2xl` | 24 / 32 | Page titles (desktop), auth headings |

List rows use 15px on phones (comfortable reading) and 14px from `md`. Nothing is below 12px.

## Spacing, radius, elevation

- Spacing: Tailwind 4px scale. Page gutters `16px` phone, `24px` tablet, `32px` desktop.
- Radius: `--radius-sm` 6px (chips), `--radius-md` 8px (inputs, buttons), `--radius-lg` 12px
  (cards, dialogs), `--radius-xl` 16px (sheets).
- Shadow: `--shadow-sm` for popovers, `--shadow-lg` for dialogs/composer. Nothing else is shadowed.

## Component sizes

| Control | Desktop | Coarse pointer |
|---|---|---|
| Button / input height | 36px | 44px |
| Icon button | 32px | 44px |
| List row min height | 64px | 76px |
| Bottom nav | — | 56px + safe area |

The coarse-pointer sizes are applied with `@media (pointer: coarse)` through the `touch:` variant.

## States

- Focus: 2px `--accent` ring with 2px offset, `:focus-visible` only.
- Disabled: 50% opacity, `not-allowed` cursor, no hover.
- Loading: skeletons matching final layout (no layout shift); buttons show a spinner and keep width.
- Error: `--danger` text + icon, never colour alone. Success: toast with `--success` icon.
- Motion: 120–200ms ease-out; respects `prefers-reduced-motion`.

## Iconography

Lucide, 16px in dense desktop UI, 20px in navigation and on touch. Stroke width 1.75.
