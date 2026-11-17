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
  "flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground-muted transition-colors hover:bg-muted hover:text-foreground aria-[current=true]:bg-accent-soft aria-[current=true]:font-medium aria-[current=true]:text-accent touch:h-11";

/** Unified inbox vs. one mailbox. Works in the full sidebar, the rail and the drawer. */
export function AccountSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("accounts");
  const accounts = useAccounts();
  const { accountId } = useAccountFilter();
  const params = useParams<{ view?: string }>();
  // Custom folders belong to one mailbox, so switching mailbox resets to the inbox.
  const view = params.view && !params.view.startsWith("folder-") && params.view !== "search" ? params.view : "inbox";

  if (accounts.isPending) {
    return (
      <div className="flex flex-col gap-1.5 px-2.5 py-1">
        <Skeleton className="h-7" />
        <Skeleton className="h-7" />
      </div>
    );
  }
  const items = accounts.data ?? [];
  if (items.length === 0) return null;

  return (
    <nav aria-label={t("switcherLabel")}>
      <ul className="flex flex-col gap-0.5">
        <li>
          <Tooltip label={t("allAccounts")} side="right">
            <Link
              href={`/mail/${view}`}
              aria-current={accountId === null}
              aria-label={t("allAccounts")}
              onClick={onNavigate}
              className={itemClasses}
            >
              <Mails className="size-4 shrink-0" aria-hidden />
              <span className="sb-expanded min-w-0 flex-1 truncate">{t("allAccounts")}</span>
            </Link>
          </Tooltip>
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
                <span className="inline-flex size-4 shrink-0 items-center justify-center">
                  <AccountDot color={account.color} className="size-2.5" />
                </span>
                <span className="sb-expanded min-w-0 flex-1 truncate">{accountLabel(account)}</span>
                {account.status !== "active" ? (
                  <AlertCircle
                    className={cn("sb-expanded size-4 shrink-0 text-warning")}
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
