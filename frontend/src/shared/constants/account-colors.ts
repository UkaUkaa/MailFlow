/**
 * Default identification hues for connected accounts (DESIGN_SYSTEM.md), offered as presets.
 * The user may pick any other colour; the backend hands these out in turn to new mailboxes.
 */
export const ACCOUNT_COLORS = [
  "#3355e0",
  "#0e8f8f",
  "#1f8a4c",
  "#a86a00",
  "#c2513a",
  "#b8388a",
  "#7a4fd6",
  "#5d6577",
] as const;

export const DEFAULT_ACCOUNT_COLOR = ACCOUNT_COLORS[0];

/** `#rrggbb` in lower case (also accepts `rrggbb` and `#rgb`), or `null` for anything else. */
export function normalizeHexColor(value: string): string | null {
  const raw = value.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${[...raw].map((char) => char + char).join("")}`;
  return /^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : null;
}

/**
 * The same eight hues, 15% darker, for avatar discs: white initials reach at least 5:1 on each.
 * An avatar never fetches a picture; its colour is derived from the address alone.
 */
export const AVATAR_COLORS = [
  "#2b48be",
  "#0c7a7a",
  "#1a7541",
  "#8f5a00",
  "#a54531",
  "#9c3075",
  "#6843b6",
  "#4f5665",
] as const;

/** Deterministic colour for a sender: the same address always gets the same hue. */
export function avatarColor(seed: string): string {
  let hash = 0;
  for (const char of seed.trim().toLowerCase()) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}
