"use client";

import { CalendarClock, Clock, Menu, Paperclip, TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Skeleton } from "@/shared/components/feedback/skeleton";
import { EmptyState, ErrorState } from "@/shared/components/feedback/states";
import { useShell } from "@/shared/components/layout/app-shell";
import { Pane, PaneScroll } from "@/shared/components/layout/pane";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { Button } from "@/shared/components/ui/button";
import { addressLabel } from "@/shared/types/address";
import { formatScheduleDate } from "@/shared/utils/format";
import { useOutbox } from "../api";
import { useScheduledActions } from "../hooks/use-scheduled-actions";
import type { OutboxDetail, OutboxItem } from "../types";
import { SendLaterMenu } from "./send-later-menu";

function ListSkeleton() {
  return (
    <ul aria-hidden>
      {Array.from({ length: 4 }, (_, index) => (
        <li key={index} className="flex flex-col gap-2 px-4 py-4 md:px-5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </li>
      ))}
    </ul>
  );
}

function ScheduledRow({
  item,
  busy,
  onReschedule,
  onCancel,
}: {
  item: OutboxItem;
  busy: boolean;
  onReschedule: (sendAt: Date) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("outbox");
  const locale = useLocale();
  const recipients = [...item.to, ...item.cc, ...item.bcc].map(addressLabel).join(", ");
  const failed = item.status === "failed";
  const sending = item.status === "sending";
  const date = formatScheduleDate(item.send_at, locale);

  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-border px-4 py-3 md:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {recipients ? t("to", { recipients }) : t("noRecipients")}
        </p>
        {item.attachment_count > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-foreground-muted">
            <Paperclip className="size-3.5" aria-hidden />
            <span className="sr-only">{t("attachments", { count: item.attachment_count })}</span>
            <span aria-hidden>{item.attachment_count}</span>
          </span>
        ) : null}
      </div>
      <p className="min-w-0 truncate text-[13px] font-medium text-foreground">{item.subject || t("noSubject")}</p>
      {item.snippet ? <p className="min-w-0 truncate text-[13px] text-foreground-muted">{item.snippet}</p> : null}

      {failed ? (
        <p role="status" className="mt-1 flex min-w-0 items-start gap-1.5 text-[13px] text-danger">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {t(item.error_code === "provider_auth_required" ? "failed.provider_auth_required" : "failed.generic")}
          </span>
        </p>
      ) : (
        <p className="mt-1 flex min-w-0 items-start gap-1.5 text-[13px] text-foreground-muted">
          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{sending ? t("sendingNow") : t("sendsAt", { date })}</span>
        </p>
      )}

      {/* Always visible: nothing here depends on hover. */}
      <div className="mt-1.5 flex min-w-0 flex-wrap gap-2">
        <SendLaterMenu
          title={t("rescheduleTitle")}
          confirmLabel={t("reschedule")}
          align="start"
          onSelect={onReschedule}
          trigger={
            <Button size="sm" disabled={busy || sending}>
              {failed ? t("retry") : t("reschedule")}
            </Button>
          }
        />
        <Button size="sm" variant="danger-ghost" disabled={busy || sending} onClick={onCancel}>
          {t("cancelSend")}
        </Button>
      </div>
    </li>
  );
}

/**
 * The Scheduled view: sends waiting for their time (and those that failed), soonest first.
 * It takes the place of the conversation list, so it is a single pane on phones and the list
 * column on tablets and desktops. `accountId` shows a fixed mailbox instead of the one in the
 * URL (the still list behind the settings dialog).
 */
export function ScheduledList({
  onReopen,
  accountId: fixedAccountId,
}: {
  onReopen: (detail: OutboxDetail) => void;
  accountId?: string | null;
}) {
  const t = useTranslations("outbox");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const shell = useShell();
  const urlAccountId = useSearchParams().get("account");
  const accountId = fixedAccountId === undefined ? urlAccountId : fixedAccountId;
  const outbox = useOutbox();
  const { reschedule, cancel, busyId } = useScheduledActions(onReopen);
  const [confirming, setConfirming] = useState<OutboxItem | null>(null);

  const items = (outbox.data ?? []).filter((item) => !accountId || item.account_id === accountId);

  return (
    <Pane className="h-full w-full bg-surface">
      <header className="shrink-0 pt-safe">
        <div className="flex min-h-14 min-w-0 items-center gap-1 pr-2 pl-2 md:min-h-[76px] md:pr-3 md:pl-5">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={tn("openMenu")} onClick={shell.openDrawer}>
            <Menu />
          </Button>
          <div className="min-w-0 flex-1 pl-1 md:pl-0">
            <h1 className="truncate text-base leading-tight font-semibold text-foreground md:text-sm">{t("title")}</h1>
            {outbox.isSuccess ? (
              <p className="mt-0.5 truncate text-xs text-foreground-subtle md:text-[11px]">{t("count", { count: items.length })}</p>
            ) : null}
          </div>
        </div>
      </header>

      {outbox.isPending ? (
        <div role="status" aria-label={tc("loading")} className="min-h-0 flex-1 overflow-hidden">
          <ListSkeleton />
        </div>
      ) : outbox.isError ? (
        <ErrorState
          title={tc("loadFailedTitle")}
          description={tc("loadFailedDescription")}
          action={<Button onClick={() => void outbox.refetch()}>{tc("retry")}</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState icon={CalendarClock} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <PaneScroll>
          <ul aria-label={t("title")} className="pb-safe">
            {items.map((item) => (
              <ScheduledRow
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onReschedule={(sendAt) => reschedule(item, sendAt)}
                onCancel={() => setConfirming(item)}
              />
            ))}
          </ul>
        </PaneScroll>
      )}

      <ResponsiveDialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? undefined : setConfirming(null))}
        title={t("cancelTitle")}
        description={t("cancelDescription")}
        closeLabel={tc("close")}
        footer={
          <>
            <Button onClick={() => setConfirming(null)}>{t("keepScheduled")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirming) cancel(confirming);
                setConfirming(null);
              }}
            >
              {t("cancelSend")}
            </Button>
          </>
        }
      />
    </Pane>
  );
}
