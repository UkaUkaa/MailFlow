"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LanguageSwitch, ThemeSwitch } from "@/shared/components/layout/preferences";
import { BrandMark } from "@/shared/components/layout/brand";

/** Frame for every signed-out screen: brand, language and theme controls, centred card. */
export function AuthShell({ children }: { children: ReactNode }) {
  const t = useTranslations("settings.appearance");
  return (
    <div className="flex min-h-dvh flex-col bg-surface px-safe">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <BrandMark />
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <LanguageSwitch label={t("language")} />
          <ThemeSwitch
            label={t("theme")}
            names={{ system: t("themes.system"), light: t("themes.light"), dark: t("themes.dark") }}
          />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="w-full max-w-[26rem] rounded-xl border border-border bg-surface-raised p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

export function AuthHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight break-words text-foreground">{title}</h1>
      {description ? <p className="text-sm break-words text-foreground-muted">{description}</p> : null}
    </div>
  );
}

export function FormAlert({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "success" }) {
  if (!children) return null;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={
        tone === "danger"
          ? "rounded-md bg-danger-soft px-3 py-2.5 text-[13px] break-words text-danger"
          : "rounded-md bg-accent-soft px-3 py-2.5 text-[13px] break-words text-foreground"
      }
    >
      {children}
    </div>
  );
}
