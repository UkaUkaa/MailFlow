"use client";

import { PanelLeftClose, PanelLeftOpen, Settings, SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { AccountSwitcher } from "@/modules/accounts";
import { useComposer } from "@/modules/composer";
import { FolderNav } from "@/modules/folders";
import { Link, usePathname } from "@/infrastructure/i18n/navigation";
import { useShell, type SidebarVariant } from "@/shared/components/layout/app-shell";
import { BrandGlyph } from "@/shared/components/layout/brand";
import { PaneScroll } from "@/shared/components/layout/pane";
import { Button } from "@/shared/components/ui/button";
import { Tooltip } from "@/shared/components/ui/tooltip";

/**
 * Full navigation: accounts, views with unread counts, folders, settings. The same content is
 * the flyout next to the rail, the pinned sidebar and the phone drawer.
 */
export function SidebarContent({ variant }: { variant: SidebarVariant }) {
  const t = useTranslations("nav");
  const shell = useShell();
  const composer = useComposer();
  const pathname = usePathname();
  // Temporary surfaces close when a destination is chosen; the pinned sidebar stays.
  const onNavigate = variant === "pinned" ? undefined : shell.closeNavigation;
  const compose = () => {
    onNavigate?.();
    composer.compose();
  };
  const pinLabel = shell.pinned ? t("unpinSidebar") : t("pinSidebar");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 pr-2 pl-4">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <BrandGlyph />
          <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">MailFlow</span>
        </span>
        {variant !== "drawer" ? (
          <Tooltip label={pinLabel}>
            <Button variant="ghost" size="icon" aria-label={pinLabel} aria-pressed={shell.pinned} onClick={shell.togglePinned}>
              {shell.pinned ? <PanelLeftClose /> : <PanelLeftOpen />}
            </Button>
          </Tooltip>
        ) : null}
      </div>

      {variant !== "flyout" ? (
        <div className="shrink-0 px-3 pb-3">
          <Button variant="primary" className="w-full" onClick={compose}>
            <SquarePen className="size-4" aria-hidden />
            <span className="truncate">{t("compose")}</span>
          </Button>
        </div>
      ) : null}

      <PaneScroll className="flex flex-col gap-3 px-3 pb-3">
        <FolderNav onNavigate={onNavigate} />
        <div className="flex flex-col gap-1">
          <h3 className="px-2 text-xs font-medium text-foreground-subtle">{t("accounts")}</h3>
          <AccountSwitcher onNavigate={onNavigate} />
        </div>
      </PaneScroll>

      <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Link
          href="/settings"
          onClick={onNavigate}
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          className="flex h-[31px] min-w-0 items-center gap-2.5 rounded-sm px-2 text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-accent-foreground touch:h-11"
        >
          <Settings className="size-4 shrink-0 touch:size-5" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{t("settings")}</span>
        </Link>
      </div>
    </div>
  );
}
