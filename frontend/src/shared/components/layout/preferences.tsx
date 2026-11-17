"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/infrastructure/i18n/navigation";
import { locales, type AppLocale } from "@/infrastructure/i18n/routing";
import { useTheme, type ThemePreference } from "@/infrastructure/theme";
import { cn } from "@/shared/lib/cn";

const segment =
  "inline-flex h-8 min-w-9 flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2.5 text-[13px] font-medium text-foreground-muted transition-colors hover:text-foreground aria-pressed:bg-surface-raised aria-pressed:text-foreground aria-pressed:shadow-sm touch:h-10 touch:min-w-11";
const group = "inline-flex max-w-full items-center gap-0.5 rounded-md border border-border bg-muted p-0.5";

const LOCALE_NAMES: Record<AppLocale, { short: string; full: string }> = {
  en: { short: "EN", full: "English" },
  uk: { short: "UK", full: "Українська" },
};

/** Switches the locale segment of the URL; next-intl stores the choice in a cookie. */
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div role="group" aria-label={label} className={cn(group, className)}>
      {locales.map((item) => (
        <button
          key={item}
          type="button"
          lang={item}
          aria-pressed={locale === item}
          aria-label={LOCALE_NAMES[item].full}
          onClick={() => {
            if (item === locale) return;
            const query = searchParams.toString();
            onChange?.(item);
            router.replace(`${pathname}${query ? `?${query}` : ""}`, { locale: item });
          }}
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
