"use client";

import { CalendarClock } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/infrastructure/i18n/navigation";
import { navIcon, navLabel, navRow, navTrailing } from "@/shared/components/layout/nav-row";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { useOutbox } from "../api";

/** Route segment of the Scheduled view: `/mail/scheduled`. */
export const SCHEDULED_VIEW = "scheduled";

/**
 * The "Scheduled" row of the navigation column, with the number of sends waiting. It follows
 * the mailbox filter like the mail views beside it.
 */
export function ScheduledNavItem({ onNavigate, expanded = true }: { onNavigate?: () => void; expanded?: boolean }) {
  const t = useTranslations("outbox");
  const params = useParams<{ view?: string }>();
  const accountId = useSearchParams().get("account");
  const outbox = useOutbox();
  const count = (outbox.data ?? []).filter((item) => !accountId || item.account_id === accountId).length;
  const label = t("title");

  return (
    <li>
      <Tooltip label={label} side="right" disabled={expanded}>
        <Link
          href={{ pathname: `/mail/${SCHEDULED_VIEW}`, query: accountId ? { account: accountId } : undefined }}
          aria-current={params.view === SCHEDULED_VIEW ? "page" : undefined}
          aria-label={count > 0 ? t("navWithCount", { count }) : label}
          onClick={onNavigate}
          className={navRow}
        >
          <span className={navIcon}>
            <CalendarClock aria-hidden />
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
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </Link>
      </Tooltip>
    </li>
  );
}
