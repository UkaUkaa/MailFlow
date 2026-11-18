/**
 * Building blocks of the navigation column. The collapsed rail and the expanded menu are the
 * same rows: a fixed icon cell whose centre sits on the rail's axis (35px, half of the 70px
 * rail), followed by a label. The row has fixed side margins, so its width simply follows the
 * column (explicit, because a `<button>` does not stretch): 28px (just the icon cell) when collapsed, the rest of the 240px when expanded.
 * Nothing moves between the two states; the labels are clipped and faded.
 *
 * `mf-nav-label` / `mf-nav-rail-only` are styled in `globals.css` from `html[data-nav]`.
 */
export const navRowBox =
  "relative mx-[21px] flex h-7 w-[calc(100%-42px)] min-w-0 shrink-0 items-center overflow-hidden whitespace-nowrap rounded-[7px] touch:mx-[13px] touch:h-11 touch:w-[calc(100%-26px)]";

export const navRow = `${navRowBox} text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-accent-foreground aria-[current=true]:bg-accent-soft aria-[current=true]:font-medium aria-[current=true]:text-foreground`;

/** 28×28 (44×44 on touch) cell holding a 20px glyph. */
export const navIcon = "relative flex size-7 shrink-0 items-center justify-center touch:size-11 [&_svg]:size-5";

export const navLabel = "mf-nav-label min-w-0 flex-1 truncate pr-2 pl-1 text-left";

/** Right-aligned extra of an expanded row (unread count, status mark). */
export const navTrailing = "mf-nav-label shrink-0 pr-2 text-xs font-medium tabular-nums";

/** Vertical rhythm of a group of rows: 31px pitch. */
export const navGroup = "flex flex-col gap-[3px] touch:gap-0.5";
