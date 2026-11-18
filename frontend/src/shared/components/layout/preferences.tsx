"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/infrastructure/i18n/navigation";
import { locales, type AppLocale } from "@/infrastructure/i18n/routing";
import { useTheme, type ThemePreference } from "@/infrastructure/theme";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { group, segment } from "@/shared/components/ui/segmented";
import { cn } from "@/shared/lib/cn";

const LOCALE_NAMES: Record<AppLocale, { short: string; full: string }> = {
  en: { short: "EN", full: "English" },
  uk: { short: "UK", full: "Українська" },
};

/** Replaces the locale segment of the current URL; next-intl stores the choice in a cookie. */
function useSwitchLocale(onChange?: (locale: AppLocale) => void): (next: AppLocale) => void {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (next) => {
    if (next === locale) return;
    const query = searchParams.toString();
    onChange?.(next);
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { locale: next });
  };
}

/** Parts of a navigation row, supplied by the caller (see `nav-row.ts`). */
interface RowParts {
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
  /** The row's label is visible, so the tooltip that repeats it stays closed. */
  expanded?: boolean;
}

/**
 * Language as one navigation row: the icon cell shows the current language code, the label
 * (visible when the column is expanded) names it, and a click switches to the next language.
 */
export function LanguageToggle({
  label,
  text,
  onChange,
  className,
  iconClassName,
  labelClassName,
  expanded = false,
}: RowParts & {
  /** Accessible name; receives the name of the language the button switches to. */
  label: (nextLanguage: string) => string;
  /** Visible label; receives the name of the current language. */
  text: (currentLanguage: string) => string;
  onChange?: (locale: AppLocale) => void;
}) {
  const locale = useLocale() as AppLocale;
  const switchLocale = useSwitchLocale(onChange);
  const next = locales[(locales.indexOf(locale) + 1) % locales.length] ?? locale;
  const name = label(LOCALE_NAMES[next].full);
  return (
    <Tooltip label={name} side="right" disabled={expanded}>
      <button type="button" aria-label={name} onClick={() => switchLocale(next)} className={className}>
        <span aria-hidden className={cn("text-[11px] leading-none font-semibold tracking-wide", iconClassName)}>
          {LOCALE_NAMES[locale].short}
        </span>
        <span aria-hidden className={labelClassName}>
          {text(LOCALE_NAMES[locale].full)}
        </span>
      </button>
    </Tooltip>
  );
}

/** Segmented language control. */
export function LanguageSwitch({
  label,
  showNames = false,
  onChange,
  className,
}: {
  label: string;
  showNames?: boolean;
  onChange?: (locale: AppLocale) => void;
  className?: string;
}) {
  const locale = useLocale();
  const switchLocale = useSwitchLocale(onChange);

  return (
    <div role="group" aria-label={label} className={cn(group, className)}>
      {locales.map((item) => (
        <button
          key={item}
          type="button"
          lang={item}
          aria-pressed={locale === item}
          aria-label={LOCALE_NAMES[item].full}
          onClick={() => switchLocale(item)}
          className={segment}
        >
          {showNames ? LOCALE_NAMES[item].full : LOCALE_NAMES[item].short}
        </button>
      ))}
    </div>
  );
}

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
const THEMES: ThemePreference[] = ["system", "light", "dark"];

export function ThemeSwitch({
  label,
  names,
  showNames = false,
  onChange,
  className,
}: {
  label: string;
  names: Record<ThemePreference, string>;
  showNames?: boolean;
  onChange?: (theme: ThemePreference) => void;
  className?: string;
}) {
  const { theme, setTheme } = useTheme();
  return (
    <div role="group" aria-label={label} className={cn(group, className)}>
      {THEMES.map((item) => {
        const Icon = THEME_ICONS[item];
        return (
          <button
            key={item}
            type="button"
            aria-pressed={theme === item}
            aria-label={names[item]}
            title={names[item]}
            onClick={() => {
              setTheme(item);
              onChange?.(item);
            }}
            className={segment}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {showNames ? <span className="truncate">{names[item]}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Theme as one navigation row: the icon cell shows the current theme's icon, the label names
 * it, and a click moves to the next theme (system → light → dark).
 */
export function ThemeCycle({
  label,
  text,
  names,
  onChange,
  className,
  iconClassName,
  labelClassName,
  expanded = false,
}: RowParts & {
  /** Accessible name; receives the name of the theme the button switches to. */
  label: (nextTheme: string) => string;
  /** Visible label; receives the name of the current theme. */
  text: (currentTheme: string) => string;
  names: Record<ThemePreference, string>;
  onChange?: (theme: ThemePreference) => void;
}) {
  const { theme, setTheme } = useTheme();
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "system";
  const Icon = THEME_ICONS[theme];
  const name = label(names[next]);
  return (
    <Tooltip label={name} side="right" disabled={expanded}>
      <button
        type="button"
        aria-label={name}
        onClick={() => {
          setTheme(next);
          onChange?.(next);
        }}
        className={className}
      >
        <span className={iconClassName}>
          <Icon className="size-5" aria-hidden />
        </span>
        <span aria-hidden className={labelClassName}>
          {text(names[theme])}
        </span>
      </button>
    </Tooltip>
  );
}
