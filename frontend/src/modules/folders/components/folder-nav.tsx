"use client";

import { Archive, File, Folder as FolderIcon, Inbox, OctagonAlert, Send, Star, Trash2, type LucideIcon } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { anyAccountSupports, useAccounts, type CapabilityName } from "@/modules/accounts";
import { Link } from "@/infrastructure/i18n/navigation";
import { navGroup, navIcon, navLabel, navRow, navRowBox, navTrailing } from "@/shared/components/layout/nav-row";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";
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

function formatCount(count: number): string {
  return count > 999 ? "999+" : String(count);
}

/**
 * Mail views of the navigation column. One list of rows for both states of the column:
 * collapsed shows the icon cell (unread as a dot, the label as a tooltip), expanded shows the
 * label and the unread count as well. See `shared/components/layout/nav-row.ts`.
 */
export function FolderNav({ onNavigate, expanded = true }: { onNavigate?: () => void; expanded?: boolean }) {
  const t = useTranslations("nav");
  const params = useParams<{ view?: string }>();
  const searchParams = useSearchParams();
  const accountId = searchParams.get("account");
  const counts = useFolderCounts(accountId);
  const query = accountId ? { account: accountId } : undefined;

  // One mailbox selected: its own capabilities. Unified: a view stays while any mailbox has it.
  // Until the mailboxes are known nothing is hidden, and the open view never disappears.
  const accounts = useAccounts();
  const relevant = accounts.data?.filter((account) => !accountId || account.id === accountId) ?? [];
  const views = SYSTEM_VIEWS.filter((role) => {
    const capability = VIEW_CAPABILITY[role];
    return !capability || relevant.length === 0 || params.view === role || anyAccountSupports(relevant, capability);
  });

  const unread = (role: SystemView): number =>
    role === "sent" || role === "trash" || role === "archive" ? 0 : (counts.data?.find((item) => item.role === role)?.unread_count ?? 0);

  return (
    <nav aria-label={t("folders")}>
      <ul className={navGroup}>
        {views.map((role) => {
          const Icon = VIEW_ICONS[role];
          const count = unread(role);
          const label = t(`views.${role}`);
          return (
            <li key={role}>
              <Tooltip label={label} side="right" disabled={expanded}>
                <Link
                  href={{ pathname: `/mail/${role}`, query }}
                  aria-current={params.view === role ? "page" : undefined}
                  aria-label={count > 0 ? t("viewWithUnread", { view: label, count }) : label}
                  onClick={onNavigate}
                  className={navRow}
                >
                  <span className={navIcon}>
                    <Icon aria-hidden />
                    {count > 0 ? (
                      <span
                        aria-hidden
                        className="mf-nav-rail-only absolute top-0.5 right-0.5 size-2 rounded-full border-2 border-rail bg-accent touch:top-2 touch:right-2"
                      />
                    ) : null}
                  </span>
                  <span className={navLabel}>{label}</span>
                  {count > 0 ? (
                    <span aria-hidden className={navTrailing}>
                      {formatCount(count)}
                    </span>
                  ) : null}
                </Link>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The selected mailbox's own folders. They only exist in the expanded column (a column of
 * identical folder icons would say nothing), below everything that both states share.
 */
export function CustomFolderNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const params = useParams<{ view?: string }>();
  const accountId = useSearchParams().get("account");
  const folders = useFolders(accountId, Boolean(accountId));
  const query = accountId ? { account: accountId } : undefined;
  const customFolders = (folders.data ?? []).filter((folder) => folder.role === "custom");
  if (customFolders.length === 0) return null;

  return (
    <nav aria-label={t("labels")}>
      <h3 className={cn(navRowBox, "h-8 items-end px-2 pb-1.5 text-xs font-medium text-foreground-muted touch:h-9")}>
        <span className="mf-nav-label truncate">{t("labels")}</span>
      </h3>
      <ul className={navGroup}>
        {customFolders.map((folder) => (
          <li key={folder.id}>
            <Link
              href={{ pathname: `/mail/${folderViewSlug(folder.id)}`, query }}
              aria-current={params.view === folderViewSlug(folder.id) ? "page" : undefined}
              onClick={onNavigate}
              className={navRow}
            >
              <span className={navIcon}>
                <FolderIcon aria-hidden />
              </span>
              <span className={navLabel}>{folder.name}</span>
              {folder.unread_count > 0 ? <span className={navTrailing}>{formatCount(folder.unread_count)}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
