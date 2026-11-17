import { describe, expect, it } from "vitest";
import { AVATAR_COLORS, avatarColor } from "./account-colors";

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
