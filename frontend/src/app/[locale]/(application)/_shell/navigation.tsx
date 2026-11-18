"use client";

import { PanelLeftClose, PanelLeftOpen, Settings, SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { AccountSwitcher } from "@/modules/accounts";
import { useComposer } from "@/modules/composer";
import { CustomFolderNav, FolderNav } from "@/modules/folders";
import { Link, usePathname } from "@/infrastructure/i18n/navigation";
import { useShell, type NavigationVariant } from "@/shared/components/layout/app-shell";
import { BrandGlyph } from "@/shared/components/layout/brand";
import { navGroup, navIcon, navLabel, navRow, navRowBox } from "@/shared/components/layout/nav-row";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";
import { QuickPreferences } from "./quick-preferences";

/**
 * The navigation column. One layout for every presentation:
 * - `aside` (tablet and wider): collapsed it is the 70px icon rail, expanded the 240px menu.
 *   The rows, their order and the position of every icon are identical in both states;
 *   expanding only widens the column and reveals the labels (and unread counts).
 * - `drawer` (phone): the same rows, always expanded, closing when a destination is chosen.
 *
 * Order: toggle, compose, mail views, accounts (then the mailbox's folders, expanded only),
 * and at the bottom language, theme and settings.
 */
export function Navigation({ variant }: { variant: NavigationVariant }) {
  const t = useTranslations("nav");
  const shell = useShell();
  const composer = useComposer();
  const pathname = usePathname();
  const drawer = variant === "drawer";
  const expanded = drawer || shell.pinned;
  const onNavigate = drawer ? shell.closeNavigation : undefined;
  const toggleLabel = shell.pinned ? t("unpinSidebar") : t("pinSidebar");

  return (
    <div className={cn("flex h-full min-h-0 flex-col py-4 touch:py-2", drawer && "mf-nav-open")}>
      {/* The toggle never moves: it is the icon cell of the first row; the brand sits beside it. */}
      <div className={navRowBox}>
        {drawer ? (
          <span className={navIcon}>
            <BrandGlyph className="size-6!" />
          </span>
        ) : (
          <Tooltip label={toggleLabel} side="right" disabled={expanded}>
            <button
              type="button"
              aria-label={toggleLabel}
              aria-expanded={shell.pinned}
              onClick={shell.togglePinned}
              className={cn(navIcon, "rounded-[7px] text-foreground-muted transition-colors hover:bg-muted hover:text-foreground")}
            >
              {shell.pinned ? <PanelLeftClose aria-hidden /> : <PanelLeftOpen aria-hidden />}
            </button>
          </Tooltip>
        )}
        <span className="mf-nav-label flex min-w-0 flex-1 items-center gap-2 pl-2">
          {drawer ? null : <BrandGlyph className="size-5" />}
          <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">MailFlow</span>
        </span>
      </div>

      <div className="mt-5 shrink-0 touch:mt-3">
        <Tooltip label={t("compose")} side="right" disabled={expanded}>
          <button
            type="button"
            aria-label={t("compose")}
            onClick={() => {
              onNavigate?.();
              composer.compose();
            }}
            className={cn(navRow, "text-foreground")}
          >
            <span className={navIcon}>
              <SquarePen aria-hidden />
            </span>
            <span className={navLabel}>{t("compose")}</span>
          </button>
        </Tooltip>
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto [scrollbar-width:none] touch:mt-3">
        <FolderNav expanded={expanded} onNavigate={onNavigate} />
        <AccountSwitcher expanded={expanded} onNavigate={onNavigate} />
        {expanded ? <CustomFolderNav onNavigate={onNavigate} /> : null}
      </div>

      <div className={cn(navGroup, "shrink-0 pt-3 pb-[env(safe-area-inset-bottom,0px)]")}>
        <QuickPreferences expanded={expanded} />
        <Tooltip label={t("settings")} side="right" disabled={expanded}>
          <Link
            href="/settings"
            onClick={onNavigate}
            aria-label={t("settings")}
            aria-current={pathname.startsWith("/settings") ? "page" : undefined}
            className={navRow}
          >
            <span className={navIcon}>
              <Settings aria-hidden />
            </span>
            <span className={navLabel}>{t("settings")}</span>
          </Link>
        </Tooltip>
      </div>
    </div>
  );
}
