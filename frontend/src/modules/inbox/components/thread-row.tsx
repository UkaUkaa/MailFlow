"use client";

import { Archive, Mail, MailOpen, Paperclip, Star, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { memo } from "react";
import { AccountDot } from "@/modules/accounts";
import type { ThreadAction, ThreadSummary } from "@/modules/emails";
import { Link } from "@/infrastructure/i18n/navigation";
import { cn } from "@/shared/lib/cn";
import { addressLabel } from "@/shared/types/address";
import { formatListDate } from "@/shared/utils/format";

function senders(thread: ThreadSummary, fallback: string): string {
  const names = thread.participants.map(addressLabel);
  if (names.length === 0) return fallback;
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} … ${names[names.length - 1]}`;
}

interface ThreadRowProps {
  thread: ThreadSummary;
  href: string;
  selected: boolean;
  view: string;
  accountColor: string | null | undefined;
  showAccount: boolean;
  /** Whether the thread's mailbox can archive; the quick action is left out when it cannot. */
  canArchive: boolean;
  onAction: (action: ThreadAction, threadId: string) => void;
}

function QuickAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-sm text-foreground-muted hover:bg-border hover:text-foreground [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

export const ThreadRow = memo(function ThreadRow({
  thread,
  href,
  selected,
  view,
  accountColor,
  showAccount,
  canArchive,
  onAction,
}: ThreadRowProps) {
  const t = useTranslations("mail");
  const locale = useLocale();
  const unread = thread.is_unread;
  const subject = thread.subject || t("noSubject");

  return (
    <li
      className={cn(
        "group relative border-b border-border",
        selected ? "bg-accent-soft" : "hover:bg-muted/60",
      )}
    >
      <Link
        href={href}
        aria-current={selected ? "true" : undefined}
        className="flex min-h-[76px] min-w-0 gap-2.5 py-3 pr-4 pl-2 -outline-offset-2 md:min-h-16 md:py-2.5"
      >
        <span className="flex w-3 shrink-0 justify-center pt-[7px]">
          {unread ? (
            <span className="size-2 rounded-full bg-accent">
              <span className="sr-only">{t("unread")}</span>
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 truncate text-[15px] md:text-sm",
                unread ? "font-semibold text-foreground" : "text-foreground",
              )}
            >
              {senders(thread, t("unknownSender"))}
            </span>
            {thread.message_count > 1 ? (
              <span className="shrink-0 text-xs text-foreground-subtle tabular-nums">{thread.message_count}</span>
            ) : null}
            <time
              dateTime={thread.last_message_at}
              className={cn(
                "ml-auto shrink-0 text-xs tabular-nums",
                unread ? "font-medium text-accent" : "text-foreground-subtle",
              )}
            >
              {formatListDate(thread.last_message_at, locale)}
            </time>
          </span>
          <span
            className={cn(
              "min-w-0 truncate text-[15px] md:text-sm",
              unread ? "font-medium text-foreground" : "text-foreground-muted",
            )}
          >
            {subject}
          </span>
          <span className="flex min-w-0 items-center gap-2 pr-8">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground-subtle md:text-[13px]">
              {thread.snippet}
            </span>
            {thread.has_attachments ? (
              <Paperclip className="size-3.5 shrink-0 text-foreground-subtle" aria-label={t("hasAttachments")} />
            ) : null}
            {showAccount ? <AccountDot color={accountColor} /> : null}
          </span>
        </span>
      </Link>

      <button
        type="button"
        aria-pressed={thread.is_starred}
        aria-label={thread.is_starred ? t("actions.unstar") : t("actions.star")}
        onClick={() => onAction(thread.is_starred ? "unstar" : "star", thread.id)}
        className="absolute right-1 bottom-0 inline-flex size-11 items-center justify-center rounded-md text-foreground-subtle hover:text-foreground md:right-2 md:bottom-1 md:size-8"
      >
        <Star className={cn("size-[18px] md:size-4", thread.is_starred && "fill-warning text-warning")} aria-hidden />
      </button>

      {/* Pointer-only shortcut; the same actions are always available in the reader toolbar. */}
      <div className="absolute top-1.5 right-2 hidden items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5 shadow-sm [@media(hover:hover)]:group-focus-within:flex [@media(hover:hover)]:group-hover:flex">
        {canArchive && view !== "trash" && view !== "spam" && view !== "archive" ? (
          <QuickAction label={t("actions.archive")} onClick={() => onAction("archive", thread.id)}>
            <Archive />
          </QuickAction>
        ) : null}
        {view !== "trash" ? (
          <QuickAction label={t("actions.trash")} onClick={() => onAction("trash", thread.id)}>
            <Trash2 />
          </QuickAction>
        ) : null}
        <QuickAction
          label={unread ? t("actions.mark_read") : t("actions.mark_unread")}
          onClick={() => onAction(unread ? "mark_read" : "mark_unread", thread.id)}
        >
          {unread ? <MailOpen /> : <Mail />}
        </QuickAction>
      </div>
    </li>
  );
});
