"use client";

import { ArrowLeft, ChevronRight, KeyRound, LogOut, Mail, MonitorSmartphone, Palette, TriangleAlert, UserRound, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useLogout } from "@/modules/authentication";
import { useCurrentUser } from "@/infrastructure/authentication";
import { Link, usePathname, useRouter } from "@/infrastructure/i18n/navigation";
import { useShell } from "@/shared/components/layout/app-shell";
import { PaneScroll } from "@/shared/components/layout/pane";
import { Avatar } from "@/shared/components/ui/avatar";
import { Button } from "@/shared/components/ui/button";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { useMediaQuery } from "@/shared/hooks/use-media-query";
import { cn } from "@/shared/lib/cn";
import { lastMailLocation } from "@/shared/lib/mail-location";

type SectionKey = "profile" | "accounts" | "appearance" | "security" | "sessions" | "danger";

/** Grouped like the dialog's navigation: you, look and feel, access, and the way out. */
const GROUPS: { key: SectionKey; icon: LucideIcon }[][] = [
  [
    { key: "profile", icon: UserRound },
    { key: "accounts", icon: Mail },
  ],
  [{ key: "appearance", icon: Palette }],
  [
    { key: "security", icon: KeyRound },
    { key: "sessions", icon: MonitorSmartphone },
  ],
  [{ key: "danger", icon: TriangleAlert }],
];
const SECTIONS = GROUPS.flat();

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const rowClasses =
  "flex h-[31px] min-w-0 items-center gap-2.5 rounded-sm px-2 text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground touch:h-12 touch:text-base";

/**
 * Settings.
 * - Phone: full pages. `/settings` is the menu, each section its own screen with a way back.
 * - Tablet and wider: a modal dialog over the mail workspace (`backdrop`), with the grouped
 *   navigation on the left and the section on the right. The URL stays the source of truth:
 *   every section is a route, so deep links and the OAuth return open the dialog on that
 *   section, and closing the dialog navigates back to the mail view the user came from.
 *
 * The layout itself is CSS (no flash before hydration); the dialog behaviour (role, Escape,
 * focus containment, inert background) is switched on in script once the width is known.
 */
export function SettingsLayout({ children, backdrop }: { children: ReactNode; backdrop?: ReactNode }) {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const router = useRouter();
  const user = useCurrentUser();
  const logout = useLogout();
  const { setNavigationInert } = useShell();
  const modal = useMediaQuery("(min-width: 48rem)");
  const frameRef = useRef<HTMLDivElement>(null);
  const atIndex = pathname === "/settings";
  const current = SECTIONS.find((section) => pathname.startsWith(`/settings/${section.key}`));

  const close = useCallback(() => router.push(lastMailLocation()), [router]);

  // While the dialog is open the rest of the app is out of reach for keyboard and pointer.
  useEffect(() => {
    if (!modal) return;
    setNavigationInert(true);
    const frame = frameRef.current;
    if (frame && !frame.contains(document.activeElement)) frame.focus();
    return () => setNavigationInert(false);
  }, [modal, setNavigationInert]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const frame = frameRef.current;
    // Keys from a dialog or menu opened on top of settings (rendered in a portal) are theirs.
    if (!modal || !frame || !frame.contains(event.target as Node)) return;
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const items = Array.from(frame.querySelectorAll<HTMLElement>(TABBABLE)).filter((item) => item.getClientRects().length > 0);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === frame)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <>
      {/* The mail workspace stays visible, dimmed and inert, behind the dialog. */}
      <div inert aria-hidden className="hidden min-h-0 min-w-0 flex-1 md:flex">
        {modal ? backdrop : null}
      </div>
      <div aria-hidden onClick={close} className="fixed inset-0 z-40 hidden animate-fade-in bg-overlay backdrop-blur-[2px] md:block" />
      <div
        ref={frameRef}
        role={modal ? "dialog" : undefined}
        aria-modal={modal || undefined}
        aria-label={modal ? t("title") : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex min-h-0 min-w-0 flex-1 outline-none md:fixed md:top-1/2 md:left-1/2 md:z-50 md:h-[min(700px,calc(100dvh-3rem))] md:w-[min(870px,calc(100vw-3rem))] md:flex-none md:-translate-x-1/2 md:-translate-y-1/2 md:overflow-hidden md:rounded-lg md:border md:border-border md:bg-surface-raised md:shadow-lg"
      >
        <div
          className={cn(
            "min-h-0 w-full min-w-0 flex-col bg-surface md:flex md:w-60 md:shrink-0 md:bg-background lg:w-[270px]",
            atIndex ? "flex" : "hidden",
          )}
        >
          <header className="flex h-14 shrink-0 items-center px-4 pt-safe md:hidden">
            <h1 className="truncate text-base font-semibold text-foreground">{t("title")}</h1>
          </header>
          <PaneScroll className="flex flex-col gap-3 p-3">
            <div className="flex min-w-0 items-center gap-2.5 rounded-lg bg-accent-soft p-3">
              <Avatar name={user.display_name || user.email} colorKey={user.email} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{user.display_name}</p>
                <p className="truncate text-xs text-foreground-muted">{user.email}</p>
              </div>
            </div>
            <nav aria-label={t("title")} className="flex flex-col gap-3">
              {GROUPS.map((group) => (
                <ul key={group[0]?.key} className="flex flex-col">
                  {group.map(({ key, icon: Icon }) => {
                    // On tablet and up the index route shows the profile section.
                    const active = current?.key === key;
                    return (
                      <li key={key}>
                        <Link
                          href={`/settings/${key}`}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            rowClasses,
                            "aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-foreground",
                            atIndex && key === "profile" && "md:bg-accent-soft md:font-medium md:text-foreground",
                          )}
                        >
                          <Icon className={cn("size-4 shrink-0 touch:size-5", key === "danger" ? "text-danger" : "text-accent")} aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{t(`nav.${key}`)}</span>
                          <ChevronRight className="size-4 shrink-0 text-foreground-subtle md:hidden" aria-hidden />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ))}
            </nav>
            <div className="mt-auto pt-2">
              <Button
                variant="ghost"
                className={cn(rowClasses, "w-full justify-start font-normal")}
                loading={logout.isPending}
                onClick={() => logout.mutate()}
              >
                <LogOut className="size-4 touch:size-5" aria-hidden />
                {t("logout")}
              </Button>
            </div>
          </PaneScroll>
        </div>
        <div className={cn("relative min-h-0 min-w-0 flex-1 flex-col bg-background md:flex md:bg-surface-raised", atIndex ? "hidden" : "flex")}>
          <header className="flex h-14 shrink-0 items-center gap-1 px-2 pt-safe md:hidden">
            <Button asChild variant="ghost" size="icon">
              <Link href="/settings" aria-label={t("back")}>
                <ArrowLeft />
              </Link>
            </Button>
            <h1 className="min-w-0 truncate text-base font-semibold text-foreground">
              {current ? t(`nav.${current.key}`) : t("title")}
            </h1>
          </header>
          <Tooltip label={t("close")} shortcut="Esc">
            <Button variant="ghost" size="icon" aria-label={t("close")} onClick={close} className="absolute top-3 right-3 z-10 max-md:hidden">
              <X />
            </Button>
          </Tooltip>
          <PaneScroll>{children}</PaneScroll>
        </div>
      </div>
    </>
  );
}
