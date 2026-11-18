import { describe, expect, it } from "vitest";
import { fromLocalInputValue, latestSchedule, scheduleProblem, schedulePresets, toLocalInputValue } from "./schedule-presets";

/** Local-time dates, so the expectations hold in whatever zone the tests run. */
const at = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute);
const ids = (now: Date) => schedulePresets(now).map((preset) => preset.id);

describe("schedulePresets", () => {
  it("offers this evening, tomorrow morning and Monday morning on a weekday morning", () => {
    // Wednesday 18 November 2026, 10:00.
    expect(schedulePresets(at(2026, 11, 18, 10))).toEqual([
      { id: "laterToday", at: at(2026, 11, 18, 18) },
      { id: "tomorrowMorning", at: at(2026, 11, 19, 8) },
      { id: "mondayMorning", at: at(2026, 11, 23, 8) },
    ]);
  });

  it("hides “Later today” when 18:00 is less than an hour away or has passed", () => {
    expect(ids(at(2026, 11, 18, 17, 0))).toContain("laterToday");
    expect(ids(at(2026, 11, 18, 17, 1))).not.toContain("laterToday");
    expect(ids(at(2026, 11, 18, 21))).toEqual(["tomorrowMorning", "mondayMorning"]);
  });

  it("hides “Monday morning” on a Sunday, when it is the same moment as tomorrow morning", () => {
    // Sunday 22 November 2026.
    expect(schedulePresets(at(2026, 11, 22, 9))).toEqual([
      { id: "laterToday", at: at(2026, 11, 22, 18) },
      { id: "tomorrowMorning", at: at(2026, 11, 23, 8) },
    ]);
  });

  it("means next week's Monday when today is Monday", () => {
    const presets = schedulePresets(at(2026, 11, 23, 7));
    expect(presets.find((preset) => preset.id === "mondayMorning")?.at).toEqual(at(2026, 11, 30, 8));
    expect(presets.find((preset) => preset.id === "tomorrowMorning")?.at).toEqual(at(2026, 11, 24, 8));
  });

  it("crosses month and year boundaries", () => {
    // Thursday 31 December 2026, 23:30.
    expect(schedulePresets(at(2026, 12, 31, 23, 30))).toEqual([
      { id: "tomorrowMorning", at: at(2027, 1, 1, 8) },
      { id: "mondayMorning", at: at(2027, 1, 4, 8) },
    ]);
  });

  it("only ever offers moments in the future", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = at(2026, 11, 21, hour, 59);
      for (const preset of schedulePresets(now)) expect(preset.at.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe("scheduleProblem", () => {
  const now = at(2026, 11, 18, 10);

  it("accepts a future moment up to one year ahead", () => {
    expect(scheduleProblem(at(2026, 11, 18, 10, 1), now)).toBeNull();
    expect(scheduleProblem(latestSchedule(now), now)).toBeNull();
  });

  it("rejects a missing, past or too distant moment", () => {
    expect(scheduleProblem(null, now)).toBe("invalid");
    expect(scheduleProblem(new Date(Number.NaN), now)).toBe("invalid");
    expect(scheduleProblem(now, now)).toBe("in_past");
    expect(scheduleProblem(at(2026, 11, 17, 10), now)).toBe("in_past");
    expect(scheduleProblem(at(2027, 11, 18, 10, 1), now)).toBe("too_far");
  });
});

describe("datetime-local values", () => {
  it("round-trips local time", () => {
    const date = at(2026, 3, 5, 7, 9);
    expect(toLocalInputValue(date)).toBe("2026-03-05T07:09");
    expect(fromLocalInputValue("2026-03-05T07:09")).toEqual(date);
  });

  it("reads nothing from an empty or malformed value", () => {
    expect(fromLocalInputValue("")).toBeNull();
    expect(fromLocalInputValue("tomorrow")).toBeNull();
  });
});
