export type DateGroupKind = "today" | "yesterday" | "thisWeek" | "lastWeek" | "month" | "monthYear";

export interface DateGroup {
  /** Stable identifier: equal for every date that belongs under the same heading. */
  key: string;
  kind: DateGroupKind;
  /** Calendar year and month (0-based) of the date, for the month headings. */
  year: number;
  month: number;
}

const DAY_MS = 86_400_000;

/** Local midnight as a day number, so differences are whole calendar days whatever the DST shift. */
function dayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/** First day of the week for a locale as a JS weekday (0 = Sunday … 6 = Saturday). Monday when unknown. */
export function firstDayOfWeek(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay;
    if (typeof firstDay === "number") return firstDay % 7;
  } catch {
    // Unknown locale tag: fall through to Monday.
  }
  return 1;
}

/**
 * Heading a list date belongs under, in the browser's time zone: Today, Yesterday, This week,
 * Last week, then the month (current year) and month + year (earlier years). `weekStartsOn` is
 * a JS weekday. A date in the future (clock skew) counts as today.
 */
export function dateGroup(iso: string, now: Date, weekStartsOn = 1): DateGroup | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = dayNumber(now);
  const day = dayNumber(date);
  const base = { year, month };

  if (day >= today) return { key: "today", kind: "today", ...base };
  if (day === today - 1) return { key: "yesterday", kind: "yesterday", ...base };
  const weekStart = today - ((now.getDay() - weekStartsOn + 7) % 7);
  if (day >= weekStart) return { key: "thisWeek", kind: "thisWeek", ...base };
  if (day >= weekStart - 7) return { key: "lastWeek", kind: "lastWeek", ...base };
  if (year === now.getFullYear()) return { key: `month-${year}-${month}`, kind: "month", ...base };
  return { key: `month-${year}-${month}`, kind: "monthYear", ...base };
}

function capitalize(value: string, locale: string): string {
  return value.charAt(0).toLocaleUpperCase(locale) + value.slice(1);
}

/** Localized month heading: the standalone month name, with the year for earlier years. */
export function formatMonthGroup(group: DateGroup, locale: string): string {
  const date = new Date(group.year, group.month, 1);
  const name = capitalize(new Intl.DateTimeFormat(locale, { month: "long" }).format(date), locale);
  return group.kind === "monthYear" ? `${name} ${new Intl.DateTimeFormat(locale, { year: "numeric" }).format(date)}` : name;
}
