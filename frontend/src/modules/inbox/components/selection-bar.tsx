"use client";

import {
  Archive,
  CheckCheck,
  Inbox,
  Mail,
  MailOpen,
  OctagonAlert,
  RotateCcw,
  ShieldCheck,
  Star,
  StarOff,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ThreadAction } from "@/modules/emails";
import { Button } from "@/shared/components/ui/button";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";

const ICONS: Record<ThreadAction, LucideIcon> = {
  mark_read: MailOpen,
  mark_unread: Mail,
  star: Star,
  unstar: StarOff,
  archive: Archive,
  unarchive: Inbox,
  trash: Trash2,
  restore: RotateCcw,
  spam: OctagonAlert,
  not_spam: ShieldCheck,
};

interface SelectionBarProps {
  count: number;
  allSelected: boolean;
  actions: readonly ThreadAction[];
  onAction: (action: ThreadAction) => void;
  onToggleAll: () => void;
  onCancel: () => void;
}

/**
 * Replaces the list header while conversations are being selected: cancel, the count and
 * "select all" on the first row, the actions for the selection on the second. Two rows keep
 * every control at full touch size on a 320px phone.
 */
export function SelectionBar({ count, allSelected, actions, onAction, onToggleAll, onCancel }: SelectionBarProps) {
  const t = useTranslations("mail.selection");
  const ta = useTranslations("mail.actions");
  const toggleAllLabel = allSelected ? t("deselectAll") : t("selectAll");

  return (
    <div className="min-w-0">
      <div className="flex min-h-14 min-w-0 items-center gap-1 px-2 md:min-h-[60px] md:px-3">
        <Tooltip label={t("cancel")}>
          <Button variant="ghost" size="icon" aria-label={t("cancel")} onClick={onCancel}>
            <X />
          </Button>
        </Tooltip>
        <h1 className="min-w-0 flex-1 truncate pl-1 text-base font-semibold text-foreground md:text-sm" aria-live="polite">
          {count === 0 ? t("prompt") : t("count", { count })}
        </h1>
        <Tooltip label={toggleAllLabel}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={toggleAllLabel}
            aria-pressed={allSelected}
            onClick={onToggleAll}
            className={cn(allSelected && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent")}
          >
            <CheckCheck />
          </Button>
        </Tooltip>
      </div>
      <div
        role="toolbar"
        aria-label={t("toolbar")}
        className="flex min-h-11 min-w-0 items-center justify-around gap-0.5 border-b border-border px-2 pb-1 md:justify-start md:gap-1 md:px-3"
      >
        {actions.map((action) => {
          const Icon = ICONS[action];
          return (
            <Tooltip key={action} label={ta(action)}>
              <Button variant="ghost" size="icon" aria-label={ta(action)} disabled={count === 0} onClick={() => onAction(action)}>
                <Icon />
              </Button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
