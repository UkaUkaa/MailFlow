"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "@/infrastructure/i18n/navigation";
import { BrandMark } from "@/shared/components/layout/brand";
import { LanguageSwitch, ThemeSwitch } from "@/shared/components/layout/preferences";
import { LegalLinks } from "./legal-links";

/** Frame for public documents: readable measure, same controls as the signed-out screens. */
export function LegalShell({ children }: { children: ReactNode }) {
  const t = useTranslations("settings.appearance");
  return (
    <div className="flex min-h-dvh flex-col bg-surface px-safe">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <Link href="/login" className="inline-flex min-h-11 min-w-0 items-center rounded-md">
          <BrandMark />
        </Link>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <LanguageSwitch label={t("language")} />
          <ThemeSwitch
            label={t("theme")}
            names={{ system: t("themes.system"), light: t("themes.light"), dark: t("themes.dark") }}
          />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 lg:py-12">{children}</main>
      <footer className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
        <LegalLinks />
      </footer>
    </div>
  );
}
