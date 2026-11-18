import { afterEach, describe, expect, it, vi } from "vitest";
import { TIME_ZONE_COOKIE, browserTimeZone, describeUserTime, localWallTime, rememberTimeZone, toServerLocalTime, utcOffset } from "./user-time";

afterEach(() => {
  document.cookie = `${TIME_ZONE_COOKIE}=; Max-Age=0; Path=/`;
  vi.restoreAllMocks();
});

describe("user time", () => {
  it("formats a moment as local wall-clock time without an offset", () => {
    expect(localWallTime(new Date(2026, 11, 8, 9, 5, 3))).toBe("2026-12-08T09:05:03");
  });

  it("stores the device time zone in the cookie the server reads", () => {
    const zone = rememberTimeZone();
    expect(zone).toBe(browserTimeZone());
    expect(document.cookie).toContain(`${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}`);
  });

  it("refreshes the cookie whenever a picked time is prepared for the server", () => {
    expect(document.cookie).not.toContain(TIME_ZONE_COOKIE);
    expect(toServerLocalTime(new Date(2027, 0, 2, 8, 0, 0))).toBe("2027-01-02T08:00:00");
    expect(document.cookie).toContain(TIME_ZONE_COOKIE);
  });

  it("formats the UTC offset with a sign", () => {
    const date = new Date(2026, 5, 1);
    vi.spyOn(date, "getTimezoneOffset").mockReturnValue(-180);
    expect(utcOffset(date)).toBe("+03:00");
    vi.spyOn(date, "getTimezoneOffset").mockReturnValue(330);
    expect(utcOffset(date)).toBe("-05:30");
  });

  it("describes the user's time for the console", () => {
    const line = describeUserTime(new Date(2026, 11, 8, 9, 5, 3));
    expect(line).toContain("User time: 2026-12-08 09:05:03");
    expect(line).toContain(browserTimeZone());
  });
});
