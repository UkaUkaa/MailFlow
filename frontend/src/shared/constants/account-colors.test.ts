import { describe, expect, it } from "vitest";
import { ACCOUNT_COLORS, AVATAR_COLORS, avatarColor, normalizeHexColor } from "./account-colors";

function luminance(hex: string): number {
  const channel = (index: number) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

describe("avatar colours", () => {
  it("is deterministic and ignores case and surrounding space", () => {
    expect(avatarColor("marta@example.com")).toBe(avatarColor("  Marta@Example.com "));
    expect(AVATAR_COLORS).toContain(avatarColor("marta@example.com"));
    expect(AVATAR_COLORS).toContain(avatarColor(""));
  });

  it("spreads different senders over the palette", () => {
    const used = new Set(Array.from({ length: 60 }, (_, index) => avatarColor(`person${index}@example.com`)));
    expect(used.size).toBeGreaterThanOrEqual(6);
  });

  it("keeps white initials readable on every disc (WCAG AA)", () => {
    for (const color of AVATAR_COLORS) expect(1.05 / (luminance(color) + 0.05), color).toBeGreaterThanOrEqual(4.5);
  });
});

describe("normalizeHexColor", () => {
  it("accepts hex colours in common spellings", () => {
    expect(normalizeHexColor("#1F8A4C")).toBe("#1f8a4c");
    expect(normalizeHexColor(" 1f8a4c ")).toBe("#1f8a4c");
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
  });

  it("rejects everything else", () => {
    for (const value of ["", "green", "#12345g", "#1234", "rgb(1,2,3)"]) expect(normalizeHexColor(value)).toBeNull();
  });
});

/** sRGB approximation of `color-mix(in oklab, color share, surface)` (`.account-tint`). */
function mix(color: string, surface: string, share: number): string {
  const channel = (hex: string, index: number) => Number.parseInt(hex.slice(index, index + 2), 16);
  return `#${[1, 3, 5]
    .map((index) => Math.round(channel(color, index) * share + channel(surface, index) * (1 - share)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe("row tint (globals.css --account-tint-hover)", () => {
  // Presets plus the extremes a user can pick from the RGB picker.
  const colors = [...ACCOUNT_COLORS, "#ffffff", "#000000", "#ffff00", "#ff0000", "#00ffff"];
  const themes = [
    { name: "light", surface: "#ffffff", muted: "#5d5f6b", hoverShare: 0.12 },
    { name: "dark", surface: "#202227", muted: "#adb0ba", hoverShare: 0.14 },
  ];

  it("keeps muted text readable on the strongest wash in both themes (WCAG AA)", () => {
    for (const theme of themes) {
      for (const color of colors) {
        expect(contrast(theme.muted, mix(color, theme.surface, theme.hoverShare)), `${theme.name} ${color}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
