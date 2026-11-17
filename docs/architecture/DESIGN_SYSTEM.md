# Design system

Original identity: quiet, typographic, neutral surfaces with a single ink-blue accent. No
gradients, no emoji, minimal shadow, restrained motion.

Layout, density and behaviour follow `docs/design/SPARK_REFERENCE.md`; the palette, tokens, brand
mark and icons are MailFlow's own (see `docs/DECISIONS.md` D31).

Tokens live in `frontend/src/app/globals.css` as CSS variables and are exposed to Tailwind through
`@theme`. Components use semantic tokens only — never raw hex values.

## Surfaces: three tonal steps

Panes are separated by tone, not by divider lines.

| Step | Token | Where |
|---|---|---|
| Deepest | `--rail` | Navigation rail |
| Base | `--background` | Reading pane, composer page, settings navigation column, auth pages |
| Raised | `--surface` | List pane, flyout / pinned sidebar, phone drawer |
| Raised (floating) | `--surface-raised` | Message cards, dialogs, sheets, docked reply, menus, inputs |

In the dark theme each step is lighter than the previous one. In the light theme the roles are
the same and the direction is the natural one for light UIs: the rail is the most tinted grey,
the reading pane a faint grey, the list pane and cards white.

## Colour tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--rail` | `#e9e9ee` | `#0a0b0d` | Navigation rail |
| `--background` | `#f5f5f7` | `#17181c` | App canvas, reading pane, composer |
| `--surface` | `#ffffff` | `#202227` | List pane, sidebar, drawer |
| `--surface-raised` | `#ffffff` | `#24262c` | Cards, dialogs, sheets, docked reply |
| `--muted` | `#ececf0` | `#2c2f36` | Hover, chips, skeletons, notes |
| `--border` | `#e2e2e8` | `#30333b` | Hairlines, card borders |
| `--border-strong` | `#cfcfd8` | `#444852` | Inputs, pills, square buttons, the empty-pane glyph |
| `--foreground` | `#17181c` | `#ededf0` | Primary text |
| `--foreground-muted` | `#5d5f6b` | `#adb0ba` | Secondary text, icons |
| `--foreground-subtle` | `#686a77` | `#9497a3` | Tertiary text, placeholders, dates, group labels |
| `--accent` | `#3355e0` | `#8098ff` | Primary action, active rail item, unread dot, links, focus |
| `--accent-hover` | `#2947c7` | `#96aaff` | Hover of accent fills |
| `--accent-foreground` | `#ffffff` | `#0c0d0f` | Text and glyphs on accent |
| `--accent-soft` | `#e6ebfd` | `#27315e` | Accent tint: selected row, active settings row, profile card, soft buttons |
| `--danger` | `#c43535` | `#f27878` | Destructive |
| `--success` | `#197a42` | `#4cc38a` | Success |
| `--warning` | `#8f5a00` | `#e0a83a` | Attention |

### Contrast (WCAG 2.1 AA), measured

| Pair | Light | Dark |
|---|---|---|
| `--foreground` on rail / background / surface / raised | 14.7 / 16.3 / 17.7 / 17.7 | 16.9 / 15.2 / 13.6 / 12.9 |
| `--foreground-muted` on rail / background / surface / raised / muted / accent-soft | 5.2 / 5.8 / 6.3 / 6.3 / 5.4 / 5.3 | 9.1 / 8.2 / 7.4 / 7.0 / 6.2 / 5.8 |
| `--foreground-subtle` on background / surface / raised | 4.9 / 5.4 / 5.4 | 6.1 / 5.5 / 5.2 |
| `--accent` on background / surface / raised / accent-soft | 5.5 / 6.0 / 6.0 / 5.0 | 6.6 / 6.0 / 5.7 / 4.7 |
| `--accent-foreground` on `--accent` | 6.0 | 7.3 |
| `--danger` on background / surface | 4.9 / 5.4 | 6.5 / 5.9 |
| `--success`, `--warning` on background | 4.9 / 5.3 | 8.0 / 8.3 |

Rules that follow from the numbers:

- `--foreground-subtle` is for text on background, surface and raised surfaces only. On
  `--accent-soft` and `--muted` it drops to 4.3–4.6:1, so text on a selected row or a chip uses
  `--foreground-muted` (the list row switches its date colour when selected).
- The empty-pane glyph and the rail's hover fill are decoration and are exempt.

Account colours (identification dots): a fixed set of eight hues, chosen per account
(`shared/constants/account-colors.ts`). Avatar discs use the same hues 15% darker
(`AVATAR_COLORS`), picked deterministically from the sender's address; white initials reach at
least 5.1:1 on every one (unit-tested). No avatar picture is ever fetched.

## Typography

Font: Inter (variable, self-hosted via `next/font`) with system fallbacks; it covers Cyrillic.
Monospace: `ui-monospace` stack. Weights in the mail workspace: regular, medium and semibold.

| Size / line height | Use |
|---|---|
| 11 / 16 | Row dates, count chips, list-header subtitle, key chips, the `DRAFT` tag |
| 12 / 16 | Meta: timestamps, "to …" line, settings descriptions, search hint |
| 13 / 18 | Row subject and preview, date-group labels, notes |
| 14 / 20–22 | Primary UI: senders, titles, navigation rows, message body, docked subject |
| 15 / 20 | Settings section title; phone list title is 16 |
| 16 / 24 | Inputs on phones (prevents iOS zoom), phone reader subject |
| 22 / 28 | Composer subject on tablet and wider (18 on phones) |
| 24 / 32 | Auth headings |

11px is the floor and is reserved for the short, non-essential labels listed above.

## Spacing, radius, elevation

- Spacing: Tailwind 4px scale. The mail workspace is dense: 12px pane inset, 20px card padding
  (16 on phones), 20px between cards.
- Radius: `--radius-sm` 6px (chips, navigation rows, search field, square buttons), 7px (rail
  buttons), `--radius-md` 8px (inputs, buttons), `--radius-lg` 12px (message cards, dialogs,
  docked reply, settings dialog), `--radius-xl` 16px (sheets), full (toolbar pill, avatars).
- Shadow: `--shadow-sm` for popovers, `--shadow-lg` for dialogs, the flyout and the docked reply.
  Nothing else is shadowed.

## Component sizes

| Component | Desktop | Coarse pointer / phone |
|---|---|---|
| Navigation rail | 70px wide; buttons 28×28, 20px glyph, 31px pitch | buttons 44×44 |
| Flyout / pinned sidebar | 240px; rows 31px | rows 44px |
| List pane | 348px (400 from 1920); header 76px | full width; header 56px |
| Thread row | 88px, three lines; gutter 30, avatar 28, text from 62 | same; star target 44 |
| Date-group label | 13px, 24px above / 12px below | same |
| Reader toolbar | 56px; pill 32px high, segments 36 wide; icon buttons 32 at 40 pitch | pill and buttons 44 |
| Message card | radius 12, 1px border, padding 20, 20px apart | padding 16, 12px apart |
| Reading column | `max-w-[52rem]` with 12px inset (frame ≤ 768px) | full width, 12px inset |
| Composer page | content from 78px, 640px wide; subject 22px | full screen; subject 18px |
| Docked reply | 520×380, radius 12, 12px from the pane edges | not used below 1024px |
| Search field | 36px, radius 6, 2px accent border on focus; suggestion rows 42px | 44px |
| Settings dialog | ≤ 870×700, radius 12; navigation 270px (240 below 1024), rows 31px | full pages; rows 48px |
| Button / input height | 36px | 44px |
| Icon button | 32px | 44px |
| Bottom nav | — | 56px + safe area |

The coarse-pointer sizes are applied with `@media (pointer: coarse)` through the `touch:` variant.

## States

- Hover: one tonal step (`--muted`), no border change. Thread rows also swap the unread dot and
  avatar for the quick-action column.
- Active / selected: solid `--accent` for the open view (rail square, sidebar pill); `--accent-soft`
  for rows (selected thread, active settings row, active account).
- Focus: 2px `--accent` ring with 2px offset, `:focus-visible` only; the search field shows a 2px
  accent border instead.
- Disabled: 50% opacity, `not-allowed` cursor, no hover.
- Loading: skeletons matching final layout (no layout shift); buttons show a spinner and keep width.
- Error: `--danger` text + icon, never colour alone. Success: toast with `--success` icon.
- Motion: 120–200ms ease-out (flyout and docked reply 140–150ms); respects `prefers-reduced-motion`.

## Tooltips

Every icon-only control has an accessible name and a tooltip with the same text (`Tooltip`).
A key chip (`shortcut` prop) is shown only for shortcuts that exist: Esc (close composer, close
settings) and Ctrl/⌘ Enter (send). There is no global shortcut layer, so navigation icons carry
no key hints.

## Iconography

Lucide only. 20px in the rail and on touch, 16px in dense desktop UI, 14px for row quick actions.
Stroke width 1.75. The empty reading pane is one 112px glyph at stroke 1 in `--border-strong`.
