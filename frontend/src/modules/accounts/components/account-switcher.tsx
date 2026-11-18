"use client";

import { AlertCircle, Mails } from "lucide-react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/infrastructure/i18n/navigation";
import { Skeleton } from "@/shared/components/feedback/skeleton";
import { navGroup, navIcon, navLabel, navRow, navRowBox } from "@/shared/components/layout/nav-row";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";
import { useAccounts } from "../api";
import { useAccountFilter } from "../hooks/use-account-filter";
import { providerLabelKey } from "../lib/providers";
import { accountLabel } from "../types";
import { accountAvatarUrl } from "../lib/avatar";
import { AccountDot } from "./account-dot";

/**
 * Unified inbox vs. one mailbox, as rows of the navigation column: collapsed shows the icon
 * cell (the mailbox's colour dot, its name as a tooltip), expanded adds the name.
 */
export function AccountSwitcher({ onNavigate, expanded = true }: { onNavigate?: () => void; expanded?: boolean }) {
  const t = useTranslations("accounts");
  const accounts = useAccounts();
  const { accountId } = useAccountFilter();
  const params = useParams<{ view?: string }>();
  // Custom folders belong to one mailbox, so switching mailbox resets to the inbox.
  const view = params.view && !params.view.startsWith("folder-") && params.view !== "search" ? params.view : "inbox";

  if (accounts.isPending) {
    return (
      <div className={cn(navGroup, "pt-8 touch:pt-9")}>
        <Skeleton className={cn(navRowBox, "bg-muted")} />
        <Skeleton className={cn(navRowBox, "bg-muted")} />
      </div>
    );
  }
  const items = accounts.data ?? [];
  if (items.length === 0) return null;

  return (
    <nav aria-label={t("switcherLabel")}>
      {/* Same height in both states: a heading when expanded, a hairline when collapsed. */}
      <h3 className={cn(navRowBox, "h-8 items-end px-2 pb-1.5 text-xs font-medium text-foreground-muted touch:h-9")}>
        <span aria-hidden className="mf-nav-rail-only absolute inset-x-1 top-1/2 border-t border-border-strong" />
        <span className="mf-nav-label truncate">{t("switcherLabel")}</span>
      </h3>
      <ul className={navGroup}>
        <li>
          <Tooltip label={t("allAccounts")} side="right" disabled={expanded}>
            <Link href={`/mail/${view}`} aria-current={accountId === null} onClick={onNavigate} className={navRow}>
              <span className={navIcon}>
                <Mails aria-hidden />
              </span>
              <span className={navLabel}>{t("allAccounts")}</span>
            </Link>
          </Tooltip>
        </li>
        {items.map((account) => (
          <li key={account.id}>
            <Tooltip
              label={`${accountLabel(account)} · ${t(`providers.${providerLabelKey(account.provider)}`)} · ${account.email_address}`}
              side="right"
              disabled={expanded}
            >
              <Link
                href={{ pathname: `/mail/${view}`, query: { account: account.id } }}
                aria-current={accountId === account.id}
                aria-label={accountLabel(account)}
                onClick={onNavigate}
                className={navRow}
              >
                <span className={navIcon}>
                  <AccountDot color={account.color} imageUrl={accountAvatarUrl(account)} className="size-2.5" />
                  {account.status !== "active" ? (
                    <span aria-hidden className="mf-nav-rail-only absolute top-0.5 right-0.5 size-2 rounded-full border-2 border-rail bg-warning touch:top-2 touch:right-2" />
                  ) : null}
                </span>
                <span className={navLabel}>{accountLabel(account)}</span>
                {account.status !== "active" ? (
                  <AlertCircle className={cn("mf-nav-label mr-2 size-4! shrink-0 text-warning")} aria-label={t(`status.${account.status}`)} />
                ) : null}
              </Link>
            </Tooltip>
          </li>
        ))}
      </ul>
    </nav>
  );
}
