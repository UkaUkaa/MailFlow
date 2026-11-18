"use client";

import { Archive, Mail, MailOpen, Paperclip, Pencil, Star, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { memo, useState, type CSSProperties, type FocusEvent } from "react";
import { AccountDot } from "@/modules/accounts";
import type { ThreadAction, ThreadSummary } from "@/modules/emails";
import { Link } from "@/infrastructure/i18n/navigation";
import { Avatar } from "@/shared/components/ui/avatar";
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
  accountImageUrl?: string | null;
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
      className="inline-flex h-6 w-8 items-center justify-center rounded-sm text-foreground-muted hover:bg-border hover:text-foreground [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

/** Pointer devices: swap the avatar for the quick actions while the row is hovered. */
const REVEAL_ON_HOVER = "[@media(hover:hover)]:group-hover:flex";
const CONCEAL_ON_HOVER = "[@media(hover:hover)]:group-hover:invisible";

function isKeyboardFocus(target: Element): boolean {
  try {
    return target.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * Three-line conversation row: unread dot and avatar in the gutter, then sender / date,
 * subject + count + attachment, and one preview line.
 */
export const ThreadRow = memo(function ThreadRow({
  thread,
  href,
  selected,
  view,
  accountColor,
  accountImageUrl,
  showAccount,
  canArchive,
  onAction,
}: ThreadRowProps) {
  const t = useTranslations("mail");
  const locale = useLocale();
  const unread = thread.is_unread;
  const first = thread.participants[0];
  const isDraft = view === "drafts";

  // Keyboard focus reveals the quick actions too. This is state rather than `:focus-within`
  // CSS because the buttons are `display: none` at rest: while focus travels from one control
  // of the row to the next no element is focused, the CSS would hide the target, and the
  // browser would drop the focus. A mouse click on the row does not count.
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const onFocus = (event: FocusEvent<HTMLLIElement>) => setKeyboardFocus(isKeyboardFocus(event.target));
  const onBlur = (event: FocusEvent<HTMLLIElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
  };

  // The whole row carries a faint wash of its mailbox's colour (`.account-tint`, globals.css).
  // Selection keeps its own fill so the open conversation is always unmistakable.
  const tinted = Boolean(accountColor) && !selected;

  return (
    <li
      data-selected={selected}
      onFocus={onFocus}
      onBlur={onBlur}
      style={tinted ? ({ "--account-tint": accountColor } as CSSProperties) : undefined}
      className={cn("group relative", selected ? "bg-accent-soft" : tinted ? "account-tint" : "hover:bg-muted/60")}
    >
      <Link
        href={href}
        aria-current={selected ? "true" : undefined}
        className="flex min-h-[88px] min-w-0 py-3 pr-5 -outline-offset-2"
      >
        <span className={cn("flex shrink-0", CONCEAL_ON_HOVER, keyboardFocus && "invisible")}>
          <span className="flex w-[30px] shrink-0 justify-center pt-[11px]">
            {unread ? (
              <span className="size-2 rounded-full bg-accent">
                <span className="sr-only">{t("unread")}</span>
              </span>
            ) : null}
          </span>
          {isDraft ? (
            <span aria-hidden className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong text-foreground-muted">
              <Pencil className="size-3.5" />
            </span>
          ) : (
            <Avatar name={first ? addressLabel(first) : ""} colorKey={first?.email ?? ""} className="mt-0.5" />
          )}
        </span>
        <span className="ml-1 flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", unread || selected ? "text-foreground" : "text-foreground/85")}>
              {senders(thread, t("unknownSender"))}
            </span>
            <time
              dateTime={thread.last_message_at}
              className={cn("shrink-0 text-[11px] tabular-nums", selected || tinted ? "text-foreground-muted" : "text-foreground-subtle")}
            >
              {formatListDate(thread.last_message_at, locale)}
            </time>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 touch:pr-8">
            <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium text-foreground", !thread.subject && "italic")}>
              {thread.subject || t("noSubject")}
            </span>
            {thread.message_count > 1 ? (
              <span className="shrink-0 rounded-[4px] bg-muted px-1 text-[11px] leading-4 text-foreground-muted tabular-nums group-data-[selected=true]:bg-background/60">
                <span aria-hidden>{thread.message_count}</span>
                <span className="sr-only">{t("messageCount", { count: thread.message_count })}</span>
              </span>
            ) : null}
            {thread.has_attachments ? (
              <Paperclip className="size-3.5 shrink-0 text-foreground-muted" aria-label={t("hasAttachments")} />
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-2 pr-7 touch:pr-8">
            <span className={cn("min-w-0 flex-1 truncate text-[13px] text-foreground-muted", !thread.snippet && "italic")}>
              {thread.snippet || t("noContent")}
            </span>
            {showAccount ? <AccountDot color={accountColor} imageUrl={accountImageUrl} /> : null}
          </span>
        </span>
      </Link>

      <button
        type="button"
        aria-pressed={thread.is_starred}
        aria-label={thread.is_starred ? t("actions.unstar") : t("actions.star")}
        onClick={() => onAction(thread.is_starred ? "unstar" : "star", thread.id)}
        className="absolute right-3 bottom-2 inline-flex size-7 items-center justify-center rounded-md text-foreground-muted hover:text-foreground touch:right-1 touch:bottom-0 touch:size-11"
      >
        <Star className={cn("size-4 touch:size-[18px]", thread.is_starred && "fill-warning text-warning")} aria-hidden />
      </button>

      {/*
        Quick actions take the place of the dot and the avatar while the row is hovered or has
        keyboard focus. They are shortcuts: the same actions are in the reader toolbar, which is
        how touch devices reach them.
      */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 hidden w-[58px] flex-col items-center justify-center gap-0.5",
          REVEAL_ON_HOVER,
          keyboardFocus && "flex",
        )}
      >
        <QuickAction
          label={unread ? t("actions.mark_read") : t("actions.mark_unread")}
          onClick={() => onAction(unread ? "mark_read" : "mark_unread", thread.id)}
        >
          {unread ? <MailOpen /> : <Mail />}
        </QuickAction>
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
      </div>
    </li>
  );
});
