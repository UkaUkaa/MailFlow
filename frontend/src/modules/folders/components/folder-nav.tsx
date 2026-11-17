"use client";

import { Archive, File, Folder as FolderIcon, Inbox, OctagonAlert, Send, Star, Trash2, type LucideIcon } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { anyAccountSupports, useAccounts, type CapabilityName } from "@/modules/accounts";
import { Link } from "@/infrastructure/i18n/navigation";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { useFolderCounts, useFolders } from "../api";
import { SYSTEM_VIEWS, folderViewSlug, type SystemView } from "../types";

export const VIEW_ICONS: Record<SystemView, LucideIcon> = {
  inbox: Inbox,
  starred: Star,
  sent: Send,
  drafts: File,
  archive: Archive,
  trash: Trash2,
  spam: OctagonAlert,
};

/** Views that only exist when a mailbox has the matching folder (not every IMAP mailbox does). */
const VIEW_CAPABILITY: Partial<Record<SystemView, CapabilityName>> = {
  drafts: "drafts",
  archive: "archive",
  spam: "spam",
};

const itemClasses =
  "flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-accent touch:h-11";

function formatCount(count: number): string {
  return count > 999 ? "999+" : String(count);
}

export function FolderNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const params = useParams<{ view?: string }>();
  const searchParams = useSearchParams();
  const accountId = searchParams.get("account");
  const counts = useFolderCounts(accountId);
  const folders = useFolders(accountId, Boolean(accountId));
  const query = accountId ? { account: accountId } : undefined;
  const customFolders = (folders.data ?? []).filter((folder) => folder.role === "custom");

  // One mailbox selected: its own capabilities. Unified: a view stays while any mailbox has it.
  // Until the mailboxes are known nothing is hidden, and the open view never disappears.
  const accounts = useAccounts();
  const relevant = accounts.data?.filter((account) => !accountId || account.id === accountId) ?? [];
  const views = SYSTEM_VIEWS.filter((role) => {
    const capability = VIEW_CAPABILITY[role];
    return !capability || relevant.length === 0 || params.view === role || anyAccountSupports(relevant, capability);
  });

  const unread = (role: SystemView): number =>
    counts.data?.find((item) => item.role === role)?.unread_count ?? 0;

  return (
    <nav aria-label={t("folders")}>
      <ul className="flex flex-col gap-0.5">
        {views.map((role) => {
          const Icon = VIEW_ICONS[role];
          const count = role === "sent" || role === "trash" || role === "archive" ? 0 : unread(role);
          const label = t(`views.${role}`);
          return (
            <li key={role}>
              <Tooltip label={label} side="right">
                <Link
                  href={{ pathname: `/mail/${role}`, query }}
                  aria-current={params.view === role ? "page" : undefined}
                  aria-label={count > 0 ? t("viewWithUnread", { view: label, count }) : label}
                  onClick={onNavigate}
                  className={itemClasses}
                >
                  <span className="relative inline-flex shrink-0">
                    <Icon className="size-4" aria-hidden />
                    {count > 0 ? (
                      <span aria-hidden className="sb-collapsed absolute -top-1 -right-1 size-1.5 rounded-full bg-accent" />
                    ) : null}
                  </span>
                  <span className="sb-expanded min-w-0 flex-1 truncate">{label}</span>
                  {count > 0 ? (
                    <span aria-hidden className="sb-expanded shrink-0 text-xs font-medium tabular-nums">
                      {formatCount(count)}
                    </span>
                  ) : null}
                </Link>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      {customFolders.length > 0 ? (
        <div className="sb-expanded mt-4">
          <h3 className="px-2.5 pb-1 text-xs font-medium text-foreground-subtle">{t("labels")}</h3>
          <ul className="flex flex-col gap-0.5">
            {customFolders.map((folder) => (
              <li key={folder.id}>
                <Link
                  href={{ pathname: `/mail/${folderViewSlug(folder.id)}`, query }}
                  aria-current={params.view === folderViewSlug(folder.id) ? "page" : undefined}
                  onClick={onNavigate}
                  className={itemClasses}
                >
                  <FolderIcon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  {folder.unread_count > 0 ? (
                    <span className="shrink-0 text-xs font-medium tabular-nums">{formatCount(folder.unread_count)}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}
