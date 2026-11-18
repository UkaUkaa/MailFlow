/**
 * Interface preferences: how the message list and the reader look. They are stored on the
 * account (`/settings`) and mirrored on `<html>` as data attributes, so that plain CSS
 * (the `compact:`, `preview-*:`, `no-avatars:` variants and the accent palettes in
 * `globals.css`) restyles the app without passing props through every component.
 *
 * The last applied values are cached in `localStorage` (`mf-interface`, nothing sensitive)
 * and restored by `interfaceInitScript` before first paint, so a reload does not flash the
 * default layout while `/settings` loads.
 */
export const LIST_DENSITIES = ["comfortable", "compact"] as const;
export const PREVIEW_LINES = [0, 1, 2] as const;
export const ACCOUNT_TINTS = ["off", "subtle", "strong"] as const;
export const ACCENT_COLORS = ["blue", "violet", "green", "orange", "pink", "graphite"] as const;
export const READER_TEXT_SIZES = ["small", "default", "large"] as const;

export type ListDensity = (typeof LIST_DENSITIES)[number];
export type PreviewLines = (typeof PREVIEW_LINES)[number];
export type AccountTint = (typeof ACCOUNT_TINTS)[number];
export type AccentColor = (typeof ACCENT_COLORS)[number];
export type ReaderTextSize = (typeof READER_TEXT_SIZES)[number];

export interface InterfacePreferences {
  list_density: ListDensity;
  list_preview_lines: PreviewLines;
  show_avatars: boolean;
  account_tint: AccountTint;
  accent_color: AccentColor;
  reader_text_size: ReaderTextSize;
}

export const DEFAULT_INTERFACE: InterfacePreferences = {
  list_density: "comfortable",
  list_preview_lines: 1,
  show_avatars: true,
  account_tint: "subtle",
  accent_color: "blue",
  reader_text_size: "default",
};

/** Base text size of a message body in the reader, in px. */
export const READER_FONT_SIZE: Record<ReaderTextSize, number> = { small: 13, default: 15, large: 17 };

export const INTERFACE_STORAGE_KEY = "mf-interface";

/** `<html>` data attributes, as `dataset` keys, for each preference. */
function attributes(preferences: InterfacePreferences): Record<string, string> {
  return {
    density: preferences.list_density,
    preview: String(preferences.list_preview_lines),
    avatars: preferences.show_avatars ? "on" : "off",
    tint: preferences.account_tint,
    accent: preferences.accent_color,
    readerText: preferences.reader_text_size,
  };
}

export function interfaceFrom(source: Partial<InterfacePreferences>): InterfacePreferences {
  return { ...DEFAULT_INTERFACE, ...source };
}

export function applyInterfacePreferences(preferences: InterfacePreferences): void {
  const values = attributes(preferences);
  Object.assign(document.documentElement.dataset, values);
  try {
    window.localStorage.setItem(INTERFACE_STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Storage unavailable (private mode): the account still holds the choice.
  }
}

/** Runs before first paint: restores the attributes from the cache, accepting only known keys. */
export const interfaceInitScript = `(function(){try{var v=JSON.parse(localStorage.getItem(${JSON.stringify(INTERFACE_STORAGE_KEY)})||"{}"),k=${JSON.stringify(Object.keys(attributes(DEFAULT_INTERFACE)))},d=document.documentElement.dataset;for(var i=0;i<k.length;i++){if(typeof v[k[i]]==="string"&&/^[a-z0-9]{1,16}$/.test(v[k[i]]))d[k[i]]=v[k[i]];}}catch(e){}})();`;
