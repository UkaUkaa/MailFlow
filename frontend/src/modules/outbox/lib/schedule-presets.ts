export type SchedulePresetId = "laterToday" | "tomorrowMorning" | "mondayMorning";

export interface SchedulePreset {
  id: SchedulePresetId;
  at: Date;
}

export type ScheduleProblem = "invalid" | "in_past" | "too_far";

const HOUR_MS = 60 * 60 * 1000;
const EVENING_HOUR = 18;
const MORNING_HOUR = 8;
/** "Later today" is only offered while it is still at least this far away. */
const MIN_LEAD_MS = HOUR_MS;

function dayAt(now: Date, addDays: number, hour: number): Date {
  // Local-time constructor: the presets follow the browser's time zone, daylight saving included.
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + addDays, hour, 0, 0, 0);
}

/**
 * The quick choices of the "Send later" menu, in the browser's time zone, soonest first.
 * "Later today" disappears in the evening; "Monday morning" disappears on Sundays, when it
 * would be the same moment as "Tomorrow morning".
 */
export function schedulePresets(now: Date): SchedulePreset[] {
  const presets: SchedulePreset[] = [];
  const evening = dayAt(now, 0, EVENING_HOUR);
  if (evening.getTime() - now.getTime() >= MIN_LEAD_MS) presets.push({ id: "laterToday", at: evening });

  const tomorrow = dayAt(now, 1, MORNING_HOUR);
  presets.push({ id: "tomorrowMorning", at: tomorrow });

  // Days until the next Monday, never today: 1 (Sunday) … 7 (Monday).
  const untilMonday = ((8 - now.getDay()) % 7) || 7;
  const monday = dayAt(now, untilMonday, MORNING_HOUR);
  if (monday.getTime() !== tomorrow.getTime()) presets.push({ id: "mondayMorning", at: monday });
  return presets;
}

/** The latest moment the server accepts: one year ahead. */
export function latestSchedule(now: Date): Date {
  const latest = new Date(now);
  latest.setFullYear(latest.getFullYear() + 1);
  return latest;
}

/** Mirrors the server's `send_at` rules so a bad choice is caught before the request. */
export function scheduleProblem(at: Date | null, now: Date): ScheduleProblem | null {
  if (!at || Number.isNaN(at.getTime())) return "invalid";
  if (at.getTime() <= now.getTime()) return "in_past";
  if (at.getTime() > latestSchedule(now).getTime()) return "too_far";
  return null;
}

/** `YYYY-MM-DDTHH:mm` in local time: the value format of `<input type="datetime-local">`. */
export function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parses a `datetime-local` value as local time; `null` when it is empty or malformed. */
export function fromLocalInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}
