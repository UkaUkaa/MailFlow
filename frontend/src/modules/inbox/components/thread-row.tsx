"use client";

import { Archive, Check, Mail, MailOpen, Paperclip, Pencil, Star, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { memo, useCallback, useState, type CSSProperties, type FocusEvent } from "react";
import { AccountDot } from "@/modules/accounts";
import type { ThreadAction, ThreadSummary } from "@/modules/emails";
import { Link } from "@/infrastructure/i18n/navigation";
import { Avatar } from "@/shared/components/ui/avatar";
import { cn } from "@/shared/lib/cn";
import { addressLabel } from "@/shared/types/address";
import { formatListDate } from "@/shared/utils/format";
import { useLongPress } from "../hooks/use-long-press";

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
  /** Selection mode: the row toggles its checkbox instead of opening the conversation. */
  selectionMode?: boolean;
  checked?: boolean;
  onToggleSelect?: (threadId: string) => void;
  /** Touch long-press; the list uses it to enter selection mode with this row selected. */
  onLongPress?: (threadId: string) => void;
}

function QuickAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-6 w-8 items-center justify-center rounded-sm compact:h-5 no-avatars:w-7 text-foreground-muted hover:bg-border hover:text-foreground [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

const ROW_TARGET =
  "flex min-h-[88px] w-full min-w-0 py-3 pr-5 text-left -outline-offset-2 select-none [-webkit-touch-callout:none] preview-none:min-h-[76px] compact:min-h-[60px] compact:py-2 compact:preview-none:min-h-[60px]";

/** The row's main control: a link to the conversation, or a checkbox while selecting. */
function RowTarget({
  selectionMode,
  checked,
  href,
  current,
  onToggle,
  children,
}: {
  selectionMode: boolean;
  checked: boolean;
  href: string;
  current: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  if (selectionMode) {
    return (
      <button type="button" role="checkbox" aria-checked={checked} onClick={onToggle} className={ROW_TARGET}>
        {children}
      </button>
    );
  }
  return (
    <Link href={href} aria-current={current ? "true" : undefined} className={ROW_TARGET}>
      {children}
    </Link>
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
 * Conversation row: unread dot and avatar in the gutter, then sender / date, subject + count +
 * attachment, and the preview. Settings → Interface reshapes it through CSS variants on
 * `<html>` (`compact:`, `preview-none:`, `preview-two:`, `no-avatars:`; globals.css): the
 * default is three lines with one line of preview.
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
  selectionMode = false,
  checked = false,
  onToggleSelect,
  onLongPress,
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
  const tinted = Boolean(accountColor) && !selected && !checked;
  const longPress = useLongPress(
    useCallback(() => {
      if (selectionMode) onToggleSelect?.(thread.id);
      else onLongPress?.(thread.id);
    }, [selectionMode, onToggleSelect, onLongPress, thread.id]),
  );

  return (
    <li
      data-selected={selected}
      onFocus={onFocus}
      onBlur={onBlur}
      style={tinted ? ({ "--account-tint": accountColor } as CSSProperties) : undefined}
      className={cn("group relative", selected || checked ? "bg-accent-soft" : tinted ? "account-tint" : "hover:bg-muted/60")}
      {...(onLongPress || selectionMode ? longPress : {})}
    >
      <RowTarget selectionMode={selectionMode} checked={checked} href={href} current={selected} onToggle={() => onToggleSelect?.(thread.id)}>
        {selectionMode ? (
          <span className="flex w-[58px] shrink-0 justify-center pt-[3px] no-avatars:w-[34px]">
            <span
              aria-hidden
              className={cn(
                "inline-flex size-5 items-center justify-center rounded-[5px] border transition-colors",
                checked ? "border-accent bg-accent text-accent-foreground" : "border-border-strong bg-background",
              )}
            >
              {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
            </span>
          </span>
        ) : (
          <span className={cn("flex shrink-0", CONCEAL_ON_HOVER, keyboardFocus && "invisible")}>
            <span className="flex w-[30px] shrink-0 justify-center pt-[11px]">
              {unread ? (
                <span className="size-2 rounded-full bg-accent">
                  <span className="sr-only">{t("unread")}</span>
                </span>
              ) : null}
            </span>
            {isDraft ? (
              <span aria-hidden className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong text-foreground-muted no-avatars:hidden">
                <Pencil className="size-3.5" />
              </span>
            ) : (
              <Avatar name={first ? addressLabel(first) : ""} colorKey={first?.email ?? ""} className="mt-0.5 no-avatars:hidden" />
            )}
          </span>
        )}
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
          <span className="flex min-w-0 items-center gap-1.5 touch:pr-8 preview-none:pr-7">
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
            {/* Without the preview line the mailbox marker moves up to the subject. */}
            {showAccount ? (
              <span className="hidden shrink-0 preview-none:inline-flex">
                <AccountDot color={accountColor} imageUrl={accountImageUrl} />
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-2 pr-7 touch:pr-8 preview-none:hidden preview-two:items-start">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] text-foreground-muted preview-two:line-clamp-2 preview-two:whitespace-normal",
                !thread.snippet && "italic",
              )}
            >
              {thread.snippet || t("noContent")}
            </span>
            {showAccount ? <AccountDot color={accountColor} imageUrl={accountImageUrl} className="preview-two:mt-1.5" imageClassName="preview-two:mt-0.5" /> : null}
          </span>
        </span>
      </RowTarget>

      {selectionMode ? null : (
        <RowActions thread={thread} view={view} canArchive={canArchive} keyboardFocus={keyboardFocus} onAction={onAction} />
      )}
    </li>
  );
});

function RowActions({
  thread,
  view,
  canArchive,
  keyboardFocus,
  onAction,
}: {
  thread: ThreadSummary;
  view: string;
  canArchive: boolean;
  keyboardFocus: boolean;
  onAction: (action: ThreadAction, threadId: string) => void;
}) {
  const t = useTranslations("mail");
  const unread = thread.is_unread;
  return (
    <>
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
          "absolute inset-y-0 left-0 hidden w-[58px] flex-col items-center justify-center gap-0.5 compact:gap-0 no-avatars:w-[34px]",
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
    </>
  );
}
