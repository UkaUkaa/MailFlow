/**
 * The user's own time. Times a person picks ("send tomorrow at 8") are theirs: the browser
 * reports where they are in the `mf_tz` cookie and sends the picked moment as local wall-clock
 * time; the server reads it in that zone and converts it to its own time (UTC).
 */

export const TIME_ZONE_COOKIE = "mf_tz";
const ONE_YEAR_S = 365 * 24 * 60 * 60;

/** IANA zone of the device, e.g. "Europe/Kyiv"; "UTC" when the browser cannot tell. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Stores the current zone in the cookie the server reads. Safe to call often. */
export function rememberTimeZone(): string {
  const zone = browserTimeZone();
  if (typeof document !== "undefined") {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax${secure}`;
  }
  return zone;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The moment as the user's wall clock shows it, without an offset: `2026-12-18T09:00:00`. */
export function localWallTime(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * A picked moment in the form the API expects: local time, with the zone cookie refreshed
 * first so the server converts it from where the user is right now.
 */
export function toServerLocalTime(date: Date): string {
  rememberTimeZone();
  return localWallTime(date);
}

/** UTC offset of the device right now, e.g. "+02:00". */
export function utcOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** One line for the browser console: the user's time, zone and offset. */
export function describeUserTime(now: Date = new Date()): string {
  return `[MailFlow] User time: ${localWallTime(now).replace("T", " ")} (${browserTimeZone()}, UTC${utcOffset(now)})`;
}
