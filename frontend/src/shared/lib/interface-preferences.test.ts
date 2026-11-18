import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACCENT_COLORS,
  applyInterfacePreferences,
  DEFAULT_INTERFACE,
  INTERFACE_STORAGE_KEY,
  interfaceFrom,
  interfaceInitScript,
} from "./interface-preferences";

const css = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8");

function luminance(hex: string): number {
  const channel = (index: number) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** `--name: #hex` declarations of the first rule whose selector starts with `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries(Array.from(body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g), (match) => [match[1], match[2]]));
}

describe("accent palettes (globals.css)", () => {
  const themes = [
    { name: "light", base: tokens(":root {"), selector: (accent: string) => `[data-accent="${accent}"] {` },
    { name: "dark", base: tokens('[data-theme="dark"] {'), selector: (accent: string) => `[data-accent="${accent}"][data-theme="dark"]` },
  ];

  it("defines every accent for both themes and keeps the default blue unchanged", () => {
    for (const theme of themes) {
      const blue = tokens(theme.selector("blue"));
      expect(blue.accent, theme.name).toBe(theme.base.accent);
      expect(blue["accent-soft"], theme.name).toBe(theme.base["accent-soft"]);
      for (const accent of ACCENT_COLORS) expect(Object.keys(tokens(theme.selector(accent)))).toEqual(["accent", "accent-hover", "accent-soft"]);
    }
  });

  it("keeps buttons, accent text and unread markers readable (WCAG AA)", () => {
    for (const theme of themes) {
      const { surface, background, "accent-foreground": onAccent } = theme.base as Record<string, string>;
      for (const accent of ACCENT_COLORS) {
        const palette = tokens(theme.selector(accent));
        const label = `${theme.name} ${accent}`;
        expect(contrast(onAccent!, palette.accent!), `${label} button`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(onAccent!, palette["accent-hover"]!), `${label} hover`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.accent!, palette["accent-soft"]!), `${label} on soft`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.accent!, surface!), `${label} on surface`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.accent!, background!), `${label} on background`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("applyInterfacePreferences", () => {
  afterEach(() => {
    window.localStorage.clear();
    for (const key of Object.keys(document.documentElement.dataset)) delete document.documentElement.dataset[key];
  });

  it("mirrors the preferences on <html> and caches them", () => {
    applyInterfacePreferences(interfaceFrom({ list_density: "compact", list_preview_lines: 0, show_avatars: false, accent_color: "green" }));
    expect(document.documentElement.dataset).toMatchObject({
      density: "compact",
      preview: "0",
      avatars: "off",
      tint: "subtle",
      accent: "green",
      readerText: "default",
    });
    expect(JSON.parse(window.localStorage.getItem(INTERFACE_STORAGE_KEY) ?? "{}")).toMatchObject({ density: "compact", accent: "green" });
  });

  it("restores the cached attributes before paint and ignores anything unexpected", () => {
    window.localStorage.setItem(
      INTERFACE_STORAGE_KEY,
      JSON.stringify({ density: "compact", accent: "pink", theme: "dark", tint: "x\" onload=\"alert(1)" }),
    );
    new Function(interfaceInitScript)();
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(document.documentElement.dataset.accent).toBe("pink");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.dataset.tint).toBeUndefined();
  });

  it("fills missing fields with the defaults", () => {
    expect(interfaceFrom({})).toEqual(DEFAULT_INTERFACE);
  });
});
