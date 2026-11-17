"use client";

import { AlertCircle, Mails } from "lucide-react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/infrastructure/i18n/navigation";
import { Skeleton } from "@/shared/components/feedback/skeleton";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";
import { useAccounts } from "../api";
import { useAccountFilter } from "../hooks/use-account-filter";
import { providerLabelKey } from "../lib/providers";
import { accountLabel } from "../types";
import { AccountDot } from "./account-dot";

const itemClasses =
  "flex h-[31px] min-w-0 items-center gap-2.5 rounded-sm px-2 text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground aria-[current=true]:bg-accent-soft aria-[current=true]:font-medium aria-[current=true]:text-foreground touch:h-11";

/** Unified inbox vs. one mailbox. Shown in the sidebar (pinned or flyout) and in the phone drawer. */
export function AccountSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("accounts");
  const accounts = useAccounts();
  const { accountId } = useAccountFilter();
  const params = useParams<{ view?: string }>();
  // Custom folders belong to one mailbox, so switching mailbox resets to the inbox.
  const view = params.view && !params.view.startsWith("folder-") && params.view !== "search" ? params.view : "inbox";

  if (accounts.isPending) {
    return (
      <div className="flex flex-col gap-1.5 px-2 py-1">
        <Skeleton className="h-7" />
        <Skeleton className="h-7" />
      </div>
    );
  }
  const items = accounts.data ?? [];
  if (items.length === 0) return null;

  return (
    <nav aria-label={t("switcherLabel")}>
      <ul className="flex flex-col">
        <li>
          <Link href={`/mail/${view}`} aria-current={accountId === null} onClick={onNavigate} className={itemClasses}>
            <Mails className="size-4 shrink-0 touch:size-5" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t("allAccounts")}</span>
          </Link>
        </li>
        {items.map((account) => (
          <li key={account.id}>
            <Tooltip label={`${t(`providers.${providerLabelKey(account.provider)}`)} · ${account.email_address}`} side="right">
              <Link
                href={{ pathname: `/mail/${view}`, query: { account: account.id } }}
                aria-current={accountId === account.id}
                aria-label={accountLabel(account)}
                onClick={onNavigate}
                className={itemClasses}
              >
                <span className="inline-flex size-4 shrink-0 items-center justify-center touch:size-5">
                  <AccountDot color={account.color} className="size-2.5" />
                </span>
                <span className="min-w-0 flex-1 truncate">{accountLabel(account)}</span>
                {account.status !== "active" ? (
                  <AlertCircle
                    className={cn("size-4 shrink-0 text-warning")}
                    aria-label={t(`status.${account.status}`)}
                  />
                ) : null}
              </Link>
            </Tooltip>
          </li>
        ))}
      </ul>
    </nav>
  );
}
