"use client";

import { ArrowLeft, ChevronRight, KeyRound, LogOut, Mail, MonitorSmartphone, Palette, TriangleAlert, UserRound, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useLogout } from "@/modules/authentication";
import { useCurrentUser } from "@/infrastructure/authentication";
import { Link, usePathname } from "@/infrastructure/i18n/navigation";
import { PaneScroll } from "@/shared/components/layout/pane";
import { Avatar } from "@/shared/components/ui/avatar";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/cn";

const SECTIONS: { key: "profile" | "accounts" | "appearance" | "security" | "sessions" | "danger"; icon: LucideIcon }[] = [
  { key: "profile", icon: UserRound },
  { key: "accounts", icon: Mail },
  { key: "appearance", icon: Palette },
  { key: "security", icon: KeyRound },
  { key: "sessions", icon: MonitorSmartphone },
  { key: "danger", icon: TriangleAlert },
];

/**
 * Phone: `/settings` is a menu, each section is its own screen with a back
 * button. Tablet and up: menu on the left, section on the right.
 */
export function SettingsLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const user = useCurrentUser();
  const logout = useLogout();
  const atIndex = pathname === "/settings";
  const current = SECTIONS.find((section) => pathname.startsWith(`/settings/${section.key}`));

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div
        className={cn(
          "min-h-0 w-full min-w-0 flex-col border-border bg-surface md:flex md:w-64 md:shrink-0 md:border-r",
          atIndex ? "flex" : "hidden",
        )}
      >
        <header className="flex h-14 shrink-0 items-center border-b border-border px-4 pt-safe">
          <h1 className="truncate text-base font-semibold text-foreground">{t("title")}</h1>
        </header>
        <PaneScroll className="p-2">
          <div className="flex min-w-0 items-center gap-3 px-2.5 py-3">
            <Avatar name={user.display_name || user.email} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{user.display_name}</p>
              <p className="truncate text-[13px] text-foreground-muted">{user.email}</p>
            </div>
          </div>
          <nav aria-label={t("title")}>
            <ul className="flex flex-col gap-0.5">
              {SECTIONS.map(({ key, icon: Icon }) => {
                // On tablet and up the index route shows the profile section.
                const active = current?.key === key;
                return (
                  <li key={key}>
                    <Link
                      href={`/settings/${key}`}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-accent touch:h-12 touch:text-base",
                        atIndex && key === "profile" && "md:bg-accent-soft md:font-medium md:text-accent",
                      )}
                    >
                      <Icon className="size-4 shrink-0 touch:size-5" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{t(`nav.${key}`)}</span>
                      <ChevronRight className="size-4 shrink-0 text-foreground-subtle md:hidden" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="mt-3 border-t border-border pt-3">
            <Button
              variant="ghost"
              className="w-full justify-start gap-2.5 px-2.5 touch:h-12 touch:text-base"
              loading={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <LogOut className="size-4 touch:size-5" aria-hidden />
              {t("logout")}
            </Button>
          </div>
        </PaneScroll>
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col bg-background md:flex", atIndex ? "hidden" : "flex")}>
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 pt-safe md:hidden">
          <Button asChild variant="ghost" size="icon">
            <Link href="/settings" aria-label={t("back")}>
              <ArrowLeft />
            </Link>
          </Button>
          <h1 className="min-w-0 truncate text-base font-semibold text-foreground">
            {current ? t(`nav.${current.key}`) : t("title")}
          </h1>
        </header>
        <PaneScroll>{children}</PaneScroll>
      </div>
    </div>
  );
}
