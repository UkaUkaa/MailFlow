import { defineRouting } from "next-intl/routing";

export const locales = ["en", "uk"] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = "en";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
  localeCookie: { name: "NEXT_LOCALE", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" },
});

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  return value === "en" || value === "uk";
}
