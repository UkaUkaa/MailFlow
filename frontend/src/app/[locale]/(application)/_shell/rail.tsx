"use client";

import { Menu, Settings, SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useComposer } from "@/modules/composer";
import { FolderNav } from "@/modules/folders";
import { Link, usePathname } from "@/infrastructure/i18n/navigation";
import { useShell } from "@/shared/components/layout/app-shell";
import { Tooltip } from "@/shared/components/ui/tooltip";

const railButton =
  "flex size-7 shrink-0 items-center justify-center rounded-[7px] text-foreground-muted transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground aria-expanded:bg-muted aria-expanded:text-foreground touch:size-11";

/**
 * Narrow icon rail (tablet and wider): compose, the mail views, "more" (the full navigation as
 * a flyout) and, at the bottom, settings. Every icon has a tooltip and an accessible name.
 */
export function Rail() {
  const t = useTranslations("nav");
  const shell = useShell();
  const composer = useComposer();
  const pathname = usePathname();

  return (
    <div className="flex h-full min-h-0 flex-col items-center gap-5 py-4 touch:gap-3 touch:py-2">
      <Tooltip label={t("compose")} side="right">
        <button type="button" aria-label={t("compose")} onClick={composer.compose} className={railButton}>
          <SquarePen className="size-5" aria-hidden />
        </button>
      </Tooltip>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-[3px] overflow-y-auto [scrollbar-width:none] touch:gap-0.5">
        <FolderNav variant="rail" />
        <Tooltip label={t("more")} side="right">
          <button
            type="button"
            aria-label={t("more")}
            aria-haspopup="dialog"
            aria-expanded={shell.flyoutOpen}
            onClick={shell.openFlyout}
            className={railButton}
          >
            <Menu className="size-5" aria-hidden />
          </button>
        </Tooltip>
      </div>
      <Tooltip label={t("settings")} side="right">
        <Link
          href="/settings"
          aria-label={t("settings")}
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          className={railButton}
        >
          <Settings className="size-5" aria-hidden />
        </Link>
      </Tooltip>
    </div>
  );
}
