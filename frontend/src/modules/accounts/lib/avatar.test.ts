import { describe, expect, it } from "vitest";
import { accountAvatarUrl, averageColor } from "./avatar";

describe("accountAvatarUrl", () => {
  it("is absent without a picture and versioned with one", () => {
    expect(accountAvatarUrl({ id: "a1", avatar_updated_at: null })).toBeNull();
    const first = accountAvatarUrl({ id: "a1", avatar_updated_at: "2026-11-18T10:00:00Z" });
    const second = accountAvatarUrl({ id: "a1", avatar_updated_at: "2026-11-18T10:05:00Z" });
    expect(first).toMatch(/^\/api\/v1\/accounts\/a1\/avatar\?v=\d+$/);
    expect(first).not.toBe(second);
  });
});

describe("averageColor", () => {
  it("averages opaque pixels and ignores transparent ones", () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0]);
    expect(averageColor(pixels)).toBe("#800080");
  });

  it("returns null for a fully transparent image", () => {
    expect(averageColor(new Uint8ClampedArray([10, 20, 30, 0]))).toBeNull();
  });
});
