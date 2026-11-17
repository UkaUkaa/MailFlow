# Spark Desktop — design reference

Observed on 2026-11-18 in Spark Desktop for macOS (window 1225 × 772 pt, dark appearance, Split
View, one Gmail account, Russian interface). Read-only walkthrough; no mail content is recorded
here. Measurements are read from screenshots and are accurate to about ±2 pt.

**What this document is for.** MailFlow adopts the *layout, structure, spacing, density and
behaviour* described below. It does not adopt Spark's name, logo, glyphs, illustrations, avatar
artwork or exact brand colours: MailFlow keeps its own tokens (`docs/architecture/DESIGN_SYSTEM.md`)
and Lucide icons. Where a colour is listed, it describes the *role and contrast relationship* to
reproduce with MailFlow tokens.

**Not observed.** Light theme (the theme setting is "follow system" and the system was dark;
switching it would change a setting), calendar, team/shared features, AI features, swipe and
shortcut settings pages, a truly empty folder.

## 1. Window structure

| Region | Width | Surface (dark) | Notes |
|---|---|---|---|
| Icon rail | 70 | darkest (`#131315`-like) | always visible |
| List pane | 348 | mid (`#27282d`-like) | no visible border; separated by tone only |
| Reading pane | rest (≈ 805) | base (`#1f2023`-like) | content inset 12 from pane edges |

Three tonal steps, no divider lines between panes. Corner radius of the window content follows
the OS window. The list pane is *lighter* than both neighbours, so the list reads as the raised
column.

## 2. Icon rail

- 28 × 28 icon buttons, 20 px glyphs, vertical pitch 31; first group (Inbox, Calendar) at the top,
  a 20 px gap, second group (Pinned, Drafts, Sent, Trash, "more" = three lines).
- Bottom: an agents entry and a 20 px circular account avatar; clicking the avatar opens Settings.
- States: default icon = muted foreground; hover = tooltip to the right (white pill, dark text,
  optional shortcut key chip); **active = solid accent rounded square (radius 7) with white glyph**.
- "More" expands a **flyout sidebar** (≈ 240 wide) over the list pane: rows 31 high with icon +
  label, unread count right-aligned on the active row, the active row is a full-width accent pill
  (radius 6). Sections: primary views, then a muted section label ("Folders") with Archive and
  "More". Bottom rows: agents, Settings. Top right of the flyout: sync and collapse buttons.
  It closes when the pointer leaves or a destination is chosen.

## 3. List pane

**Header (height ≈ 76).** Left: view title 14/semibold with a chevron (opens a view switcher) and
an 11 px muted subtitle (sort mode). Right, 20 px icons at 40 pitch: a small "done" toggle, search,
compose. In a non-inbox folder the header is a round back button (28) + folder title, with search
and compose on the right.

**Date groups.** Muted 13 px labels ("Today", "Yesterday", "This week", "Last week", month names,
then month + year) with 24 px above and 12 px below. Not sticky.

**Thread row (height ≈ 88, three text lines).**

```
[•] (avatar 28)  Sender name ............ date
                 Subject ........ [count] [clip]
                 Preview line (muted) .........
```

- Left gutter 20: 8 px accent dot when unread. Avatar 28 circle at x = 30; initials on a coloured
  disc when there is no picture. Text column starts at x = 62; right padding 20.
- Sender 14/semibold; date 11 muted, right-aligned on the sender line; subject 13/medium (primary
  colour, same weight read or unread — unread is carried by the dot and a brighter sender);
  preview 13 muted, one line (setting: 1–n lines).
- Message count = small rounded-rect chip (11 px, muted fill); attachment = clip icon at far right
  of the subject line.
- Hover: slightly lighter row background and a **vertical quick-action column replaces the dot /
  avatar gutter** (mark done, mark read/unread, trash — three 14 px icons stacked).
- Selected: full-bleed accent-tinted background (deep blue), no border, text unchanged.
- Draft rows show a pencil in a circle instead of an avatar and an italic "No subject" /
  "No content" placeholder.

**Smart grouping (Inbox only).** Above ordinary threads, category cards ("Pinned",
"Notifications", "Newsletters", "Invitations") each list a few senders as tiny avatar + name +
count chips with "+N". This is a product feature backed by classification, not just layout.

## 4. Reading pane

**Empty.** A single large, very low-contrast glyph centred in the pane. No text.

**Toolbar (y-centre 52 from top, height ≈ 56).** Left: a pill containing two segments (close ✕ |
done ✓, radius 16, 1 px border). Then borderless 20 px icon buttons at 40 pitch (trash, quick
reply, mark unread, pin, move, attach, snooze, AI, more). Right: pill buttons with icon + label
(1 px border, radius 16, height 32). No bottom border under the toolbar.

**Subject.** 14/semibold on its own line under the toolbar, left-aligned with the cards.

**Message cards.** One card per message, stacked with 20 px gaps:

- 1 px border (subtle), radius 12, surface one step above the pane, padding 20.
- Header row: avatar 28; sender 14/semibold; "to **Recipient**" 12 — "to" muted, recipient in
  accent; timestamp 12 muted right-aligned; a "…" menu at the far right.
- Body 14/22, links in accent with underline. Quoted history is collapsed behind a small "•••"
  chip.
- Footer, right-aligned: reply and forward as two borderless 20 px icons, muted, 40 apart.
- A draft inside a thread renders as a compact card: avatar, a bordered "DRAFT" tag, recipient,
  and three pill buttons (Delete, Edit, Send) on the right; body placeholder "No content".

Cards span the pane width minus the 12 px inset; there is no max reading width at this window
size.

## 5. Composer

**New message = full takeover of list + reading panes** (rail stays).

- Top-left: bordered square buttons (28, radius 6): close, and a two-button segmented control for
  window mode (docked / separate window).
- Top-right: borderless icons (AI, attach, template, reminder, send later, share), the From
  address as text with a chevron, and a send icon at the far right.
- Content column starts ≈ 78 from the pane edge, ≈ 640 wide:
  - Subject as a **title**: 22/semibold placeholder "Subject", no field chrome.
  - One line "To, Cc, Bcc" (14, muted placeholder) that expands into separate fields on focus.
  - Body placeholder 14 muted. No visible formatting toolbar until text is selected.
- No field borders, labels or dividers anywhere: the composer looks like a blank document.

**Reply = docked panel** over the lower right of the reading pane (≈ 520 × 380, radius 12, 1 px
border, raised surface):

- Header: "Re: subject" 14/semibold; right: expand, pop-out, close (bordered squares).
- "To: Recipient" 13 with the name in accent; body placeholder; collapsed quote chip "•••".
- Footer bar separated by a 1 px line: AI on the left; attach, template, reminder, send later,
  send-and-archive, share, From selector and send icon on the right.
- Opening a reply immediately shows a draft card in the thread; closing an empty reply removes it.

## 6. Search

Search **replaces the list pane content**; the reading pane shows the empty glyph.

- Input: full pane width minus 2 × 12, height 36, radius 6, 2 px accent focus border, clear button
  inside on the right.
- Below: muted "Suggestions" label, then rows 42 high: a 14 px coloured icon, the operator in
  14/medium (`from:`, `to:`, quoted phrase, `subject:`, `has: attachments`, `with: documents`,
  `in: inbox`, `in: sent`, `is: unread`, `cc:`, `since:`, `last week`), and an 11 px muted
  explanation on a second line. Icon colour encodes the operator family (people = blue, text =
  grey, attachments = green, folders = amber, dates = red).
- Escape returns to the previous list.

## 7. Settings

A **modal window** (≈ 868 × 695, radius 12) centred over a blurred, dimmed app.

- Left column 270 wide, darker surface: a profile card (avatar 28, email 14/semibold, plan badge)
  on an accent-tinted rounded rectangle, then four groups of rows (31 high, 16 px coloured icon +
  14 label) separated by 12 px gaps; the active row has an accent-tinted pill background. The list
  scrolls.
- Right column: section title 15/semibold at 40 px from the top; content max width ≈ 440.
  Each setting is a row: 16 px accent icon, title 14/semibold, optional 12 px muted description
  (max ≈ 260 wide, multi-paragraph), and a right-aligned control — a pill button (text in accent,
  destructive in red), a native-style select (≈ 205 wide), or a chevron for a sub-page. Rows are
  separated by 1 px dividers with 28 px vertical padding.
- Close: a single red dot at the top-left of the modal.

## 8. Colour roles and states (dark)

| Role | Observed | Use |
|---|---|---|
| Rail surface | near-black | deepest layer |
| Base surface | dark graphite | reading pane, composer |
| Raised surface | graphite +1 | list pane, cards, docked composer |
| Subtle border | graphite +2 | cards, pills, squares |
| Primary text | off-white | names, subjects, body |
| Muted text | grey ≈ 55% | previews, dates, labels |
| Accent | saturated blue | active rail item, unread dot, links, focus, recipient names |
| Accent tint | deep desaturated blue | selected row, active settings row |
| Destructive | soft red | destructive pill text |

Interaction: hover = one tonal step lighter, no border change; pressed/active = accent fill (rail)
or accent tint (rows); focus = 2 px accent border on inputs. Motion is minimal: flyout and modal
fade/slide in ≈ 150 ms.

## 9. Typography and density

System UI font (SF Pro) throughout. Sizes used: 11 (dates, hints), 12–13 (previews, secondary),
14 (primary UI and body), 15 (settings title), 22 (composer subject). Weights: regular and
semibold only. The interface is dense: 31 px navigation rows, 88 px three-line thread rows,
20 px card padding, 12 px pane inset.

## 10. Behaviours worth carrying over

1. Rail-first navigation with an on-demand flyout instead of a permanently open sidebar.
2. Date-grouped thread list with avatars and a three-line row.
3. Hover quick actions in the row gutter; unread carried by a dot.
4. Conversation as bordered message cards with per-message reply/forward and collapsed quotes.
5. Document-like full-pane composer for new mail; docked panel for replies.
6. Search as a mode of the list pane with operator suggestions.
7. Settings as a modal with a grouped left navigation.
8. Tooltips with shortcut hints on rail and toolbar icons.
