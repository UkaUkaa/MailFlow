import { describe, expect, it } from "vitest";
import { escapeHtml, formatBytes, formatListDate, initials } from "./format";

describe("format", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2_483_200)).toBe("2.4 MB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });

  it("shortens list dates relative to now", () => {
    const now = new Date(2026, 10, 17, 15, 0, 0);
    expect(formatListDate(new Date(2026, 10, 17, 9, 5).toISOString(), "en", now)).toMatch(/9:05/);
    expect(formatListDate(new Date(2026, 2, 4, 9, 5).toISOString(), "en", now)).toBe("Mar 4");
    expect(formatListDate(new Date(2024, 2, 4, 9, 5).toISOString(), "en", now)).toBe("Mar 4, 2024");
    expect(formatListDate(new Date(2026, 2, 4, 9, 5).toISOString(), "uk", now)).toMatch(/4 бер/);
    expect(formatListDate("not a date", "en", now)).toBe("");
  });

  it("derives initials", () => {
    expect(initials("Marta Shevchenko")).toBe("MS");
    expect(initials("billing@example.com")).toBe("B");
    expect(initials("Андрій Мельник")).toBe("АМ");
    expect(initials("")).toBe("?");
  });

  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
  });
});
