"use client";

import { PanelLeft, PenLine, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { AccountSwitcher } from "@/modules/accounts";
import { useComposer } from "@/modules/composer";
import { FolderNav } from "@/modules/folders";
import { Link, usePathname } from "@/infrastructure/i18n/navigation";
import { useShell } from "@/shared/components/layout/app-shell";
import { BrandGlyph } from "@/shared/components/layout/brand";
import { PaneScroll } from "@/shared/components/layout/pane";
import { Button } from "@/shared/components/ui/button";
import { Tooltip } from "@/shared/components/ui/tooltip";

/**
 * Navigation column. The same content serves the full sidebar, the icon rail
 * (labels are hidden by the `.mf-sidebar` CSS) and the phone drawer.
 */
export function SidebarContent({ variant }: { variant: "sidebar" | "drawer" }) {
  const t = useTranslations("nav");
  const shell = useShell();
  const composer = useComposer();
  const pathname = usePathname();
  const onNavigate = variant === "drawer" ? shell.closeDrawer : undefined;
  const compose = () => {
    onNavigate?.();
    composer.compose();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <span className="sb-expanded min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2 pl-1">
            <BrandGlyph />
            <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">MailFlow</span>
          </span>
        </span>
        {variant === "sidebar" ? (
          <Tooltip label={t("toggleSidebar")} side="right">
            <Button variant="ghost" size="icon" aria-label={t("toggleSidebar")} onClick={shell.toggleSidebar}>
              <PanelLeft />
            </Button>
          </Tooltip>
        ) : null}
      </div>

      <div className="shrink-0 px-2 pb-3">
        <div className="sb-expanded">
          <Button variant="primary" className="w-full" onClick={compose}>
            <PenLine className="size-4" aria-hidden />
            <span className="truncate">{t("compose")}</span>
          </Button>
        </div>
        <div className="sb-collapsed flex justify-center">
          <Tooltip label={t("compose")} side="right">
            <Button variant="primary" size="icon" aria-label={t("compose")} onClick={compose} className="size-9">
              <PenLine />
            </Button>
          </Tooltip>
        </div>
      </div>

      <PaneScroll className="flex flex-col gap-3 px-2 pb-2">
        <AccountSwitcher onNavigate={onNavigate} />
        <div aria-hidden className="mx-2.5 border-t border-border" />
        <FolderNav onNavigate={onNavigate} />
      </PaneScroll>

      <div className="shrink-0 border-t border-border p-2">
        <Tooltip label={t("settings")} side="right">
          <Link
            href="/settings"
            onClick={onNavigate}
            aria-label={t("settings")}
            aria-current={pathname.startsWith("/settings") ? "page" : undefined}
            className="flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-accent touch:h-11"
          >
            <Settings className="size-4 shrink-0" aria-hidden />
            <span className="sb-expanded min-w-0 flex-1 truncate">{t("settings")}</span>
          </Link>
        </Tooltip>
      </div>
    </div>
  );
}
