"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/infrastructure/i18n/navigation";
import { locales, type AppLocale } from "@/infrastructure/i18n/routing";
import { useTheme, type ThemePreference } from "@/infrastructure/theme";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";

const segment =
  "inline-flex h-8 min-w-9 flex-auto items-center justify-center gap-1.5 rounded-[5px] px-2.5 text-[13px] font-medium text-foreground-muted transition-colors hover:text-foreground aria-pressed:bg-surface-raised aria-pressed:text-foreground aria-pressed:shadow-sm touch:h-10 touch:min-w-11";
const group = "inline-flex max-w-full items-center gap-0.5 rounded-md border border-border bg-muted p-0.5";

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

/**
 * One-button language control for narrow places (the navigation rail): shows the current
 * language code and switches to the next one.
 */
export function LanguageToggle({
  label,
  onChange,
  className,
}: {
  /** Receives the name of the language the button switches to. */
  label: (nextLanguage: string) => string;
  onChange?: (locale: AppLocale) => void;
  className?: string;
}) {
  const locale = useLocale() as AppLocale;
  const switchLocale = useSwitchLocale(onChange);
  const next = locales[(locales.indexOf(locale) + 1) % locales.length] ?? locale;
  const text = label(LOCALE_NAMES[next].full);
  return (
    <Tooltip label={text} side="right">
      <button type="button" aria-label={text} onClick={() => switchLocale(next)} className={className}>
        <span aria-hidden className="text-[11px] leading-none font-semibold tracking-wide">
          {LOCALE_NAMES[locale].short}
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
 * One-button theme control for narrow places (the navigation rail): shows the current theme's
 * icon and moves to the next one (system → light → dark).
 */
export function ThemeCycle({
  label,
  names,
  onChange,
  className,
}: {
  /** Receives the name of the theme the button switches to. */
  label: (nextTheme: string) => string;
  names: Record<ThemePreference, string>;
  onChange?: (theme: ThemePreference) => void;
  className?: string;
}) {
  const { theme, setTheme } = useTheme();
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "system";
  const Icon = THEME_ICONS[theme];
  const text = label(names[next]);
  return (
    <Tooltip label={text} side="right">
      <button
        type="button"
        aria-label={text}
        onClick={() => {
          setTheme(next);
          onChange?.(next);
        }}
        className={className}
      >
        <Icon className="size-5" aria-hidden />
      </button>
    </Tooltip>
  );
}
