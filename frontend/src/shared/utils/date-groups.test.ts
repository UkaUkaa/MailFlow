import { describe, expect, it } from "vitest";
import { dateGroup, firstDayOfWeek, formatMonthGroup } from "./date-groups";

/** Local-time constructor, so the tests hold in whatever zone they run. */
const local = (year: number, month: number, day: number, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute);
const kind = (date: Date, now: Date, weekStartsOn = 1) => dateGroup(date.toISOString(), now, weekStartsOn)?.kind;

describe("dateGroup", () => {
  // Wednesday 18 November 2026.
  const now = local(2026, 11, 18, 15, 30);

  it("puts anything since local midnight under Today", () => {
    expect(kind(local(2026, 11, 18, 0, 0), now)).toBe("today");
    expect(kind(local(2026, 11, 18, 15, 29), now)).toBe("today");
  });

  it("treats a future date (clock skew) as today", () => {
    expect(kind(local(2026, 11, 19, 9), now)).toBe("today");
  });

  it("switches to Yesterday one minute before midnight", () => {
    expect(kind(local(2026, 11, 17, 23, 59), now)).toBe("yesterday");
    expect(kind(local(2026, 11, 17, 0, 0), now)).toBe("yesterday");
  });

  it("uses This week back to the first day of the week", () => {
    expect(kind(local(2026, 11, 16, 8), now)).toBe("thisWeek"); // Monday
    expect(kind(local(2026, 11, 15, 23, 59), now)).toBe("lastWeek"); // Sunday
  });

  it("honours a Sunday week start", () => {
    expect(kind(local(2026, 11, 15, 8), now, 0)).toBe("thisWeek"); // Sunday belongs to this week
    expect(kind(local(2026, 11, 14, 8), now, 0)).toBe("lastWeek");
    expect(kind(local(2026, 11, 8, 8), now, 0)).toBe("lastWeek");
    expect(kind(local(2026, 11, 7, 8), now, 0)).toBe("month");
  });

  it("uses Last week for the seven days before this week and no further", () => {
    expect(kind(local(2026, 11, 9, 0, 0), now)).toBe("lastWeek"); // Monday of last week
    expect(kind(local(2026, 11, 8, 23, 59), now)).toBe("month");
  });

  it("has no This week group on the first day of the week beyond Yesterday", () => {
    const monday = local(2026, 11, 16, 10);
    expect(kind(local(2026, 11, 15, 10), monday)).toBe("yesterday");
    expect(kind(local(2026, 11, 14, 10), monday)).toBe("lastWeek");
    expect(kind(local(2026, 11, 9, 10), monday)).toBe("lastWeek");
    expect(kind(local(2026, 11, 8, 10), monday)).toBe("month");
  });

  it("groups by month within the year and separates months", () => {
    const november = dateGroup(local(2026, 11, 2).toISOString(), now);
    const october = dateGroup(local(2026, 10, 31, 23, 59).toISOString(), now);
    expect(november).toMatchObject({ kind: "month", year: 2026, month: 10 });
    expect(october).toMatchObject({ kind: "month", year: 2026, month: 9 });
    expect(november?.key).not.toBe(october?.key);
    expect(dateGroup(local(2026, 10, 1).toISOString(), now)?.key).toBe(october?.key);
  });

  it("adds the year for earlier years, at the year boundary", () => {
    expect(kind(local(2026, 1, 1, 0, 0), now)).toBe("month");
    expect(dateGroup(local(2025, 12, 31, 23, 59).toISOString(), now)).toMatchObject({ kind: "monthYear", year: 2025, month: 11 });
  });

  it("keeps the relative groups across a month and a year boundary", () => {
    // Friday 1 January 2027: yesterday and this week are in December 2026.
    const newYear = local(2027, 1, 1, 9);
    expect(kind(local(2026, 12, 31, 22), newYear)).toBe("yesterday");
    expect(kind(local(2026, 12, 28, 9), newYear)).toBe("thisWeek");
    expect(kind(local(2026, 12, 27, 9), newYear)).toBe("lastWeek");
    expect(kind(local(2026, 12, 20, 9), newYear)).toBe("monthYear");
  });

  it("counts calendar days across a daylight-saving change", () => {
    // Europe and North America both change clocks around these dates; the result must not depend on the zone.
    const afterChange = local(2026, 3, 30, 0, 30);
    expect(kind(local(2026, 3, 29, 23, 30), afterChange)).toBe("yesterday");
    expect(kind(local(2026, 3, 28, 23, 30), afterChange)).toBe("lastWeek");
  });

  it("returns null for an invalid date", () => {
    expect(dateGroup("not a date", now)).toBeNull();
  });
});

describe("firstDayOfWeek", () => {
  it("is Monday for Ukrainian and British English, Sunday for US English", () => {
    expect(firstDayOfWeek("uk")).toBe(1);
    expect(firstDayOfWeek("en-GB")).toBe(1);
    expect(firstDayOfWeek("en-US")).toBe(0);
  });

  it("falls back to Monday for an unknown tag", () => {
    expect(firstDayOfWeek("not a locale")).toBe(1);
  });
});

describe("formatMonthGroup", () => {
  it("names the month in the locale, capitalised", () => {
    expect(formatMonthGroup({ key: "m", kind: "month", year: 2026, month: 9 }, "en")).toBe("October");
    expect(formatMonthGroup({ key: "m", kind: "month", year: 2026, month: 9 }, "uk")).toBe("Жовтень");
  });

  it("adds the year for earlier years", () => {
    expect(formatMonthGroup({ key: "m", kind: "monthYear", year: 2025, month: 11 }, "en")).toBe("December 2025");
    expect(formatMonthGroup({ key: "m", kind: "monthYear", year: 2025, month: 11 }, "uk")).toBe("Грудень 2025");
  });
});
