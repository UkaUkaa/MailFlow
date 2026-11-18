"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ComposerProvider } from "@/modules/composer";
import { SettingsSync } from "@/modules/settings";
import { SessionGuard } from "@/infrastructure/authentication";
import { AppShell } from "@/shared/components/layout/app-shell";
import { BottomNav } from "./bottom-nav";
import { Navigation } from "./navigation";

/** Composition root of the signed-in area: session, composer and the responsive frame. */
export function ApplicationShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  return (
    <SessionGuard>
      <SettingsSync />
      <ComposerProvider>
        <AppShell
          drawerTitle={t("menu")}
          closeLabel={tc("close")}
          navigation={(variant) => <Navigation variant={variant} />}
          bottomNav={<BottomNav />}
        >
          {children}
        </AppShell>
      </ComposerProvider>
    </SessionGuard>
  );
}
