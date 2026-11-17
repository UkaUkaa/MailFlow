"use client";

import {
  Archive,
  ArrowLeft,
  Forward,
  Inbox,
  MailWarning,
  MoreHorizontal,
  OctagonAlert,
  Reply,
  ReplyAll,
  RotateCcw,
  ShieldCheck,
  Star,
  Trash2,
  Mail,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { AccountDot, useAccounts } from "@/modules/accounts";
import { useComposer } from "@/modules/composer";
import { useSettings } from "@/modules/settings";
import { isApiError } from "@/infrastructure/api-client";
import { Link, useRouter } from "@/infrastructure/i18n/navigation";
import { Skeleton } from "@/shared/components/feedback/skeleton";
import { EmptyState, ErrorState } from "@/shared/components/feedback/states";
import { Pane, PaneScroll } from "@/shared/components/layout/pane";
import { ResponsiveMenu, type MenuItem } from "@/shared/components/layout/responsive-menu";
import { Button } from "@/shared/components/ui/button";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";
import { useThread } from "../api";
import { useThreadActions } from "../hooks/use-thread-actions";
import { isActionAvailable } from "../lib/capabilities";
import type { Message, ThreadAction, ThreadDetail } from "../types";
import { MessageCard } from "./message-card";

function ToolbarButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <Button variant="ghost" size="icon" aria-label={label} aria-pressed={active} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

function ReplyActions({ message, className, compact = false }: { message: Message; className?: string; compact?: boolean }) {
  const t = useTranslations("reader");
  const composer = useComposer();
  const multiple = message.to.length + message.cc.length > 1;
  // Compact (phone bar): only Reply keeps its label on narrow screens; the
  // other two become labelled icon buttons so long translations never truncate.
  const secondary = compact ? "shrink-0 min-[30rem]:min-w-0 min-[30rem]:flex-1 max-[29.99rem]:w-11 max-[29.99rem]:px-0" : "";
  const secondaryLabel = compact ? "truncate max-[29.99rem]:sr-only" : "truncate";
  return (
    <div className={cn("flex min-w-0 gap-2", className)}>
      <Button className={cn("min-w-0", compact && "flex-1")} onClick={() => composer.reply(message, "reply")}>
        <Reply className="size-4" aria-hidden />
        <span className="truncate">{t("reply")}</span>
      </Button>
      {multiple ? (
        <Button className={secondary} onClick={() => composer.reply(message, "reply_all")}>
          <ReplyAll className="size-4" aria-hidden />
          <span className={secondaryLabel}>{t("replyAll")}</span>
        </Button>
      ) : null}
      <Button className={secondary} onClick={() => composer.reply(message, "forward")}>
        <Forward className="size-4" aria-hidden />
        <span className={secondaryLabel}>{t("forward")}</span>
      </Button>
    </div>
  );
}

function ReaderSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 md:px-8">
      <Skeleton className="h-7 w-3/4" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}

function ThreadBody({ thread, unified }: { thread: ThreadDetail; unified: boolean }) {
  const t = useTranslations("reader");
  const accounts = useAccounts();
  const settings = useSettings();
  const account = accounts.data?.find((item) => item.id === thread.account_id);
  const lastIndex = thread.messages.length - 1;
  const last = thread.messages.findLast((message) => !message.is_draft) ?? null;

  return (
    <>
      <PaneScroll>
        {/* Reading width is capped so lines stay comfortable on wide and ultrawide screens. */}
        <div className="mx-auto w-full max-w-3xl px-4 pt-5 pb-6 md:px-8">
          <h1 className="text-xl leading-snug font-semibold break-words text-foreground md:text-2xl">
            {thread.subject || t("noSubject")}
          </h1>
          {unified && account ? (
            <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-foreground-muted">
              <AccountDot color={account.color} />
              <span className="truncate">{account.email_address}</span>
            </p>
          ) : null}
          <div className="mt-4 border-t border-border">
            {thread.messages.map((message, index) => (
              <MessageCard
                key={message.id}
                message={message}
                defaultExpanded={index === lastIndex || !message.is_read}
                alwaysShowImages={settings.data?.load_remote_images ?? false}
              />
            ))}
          </div>
          {last ? <ReplyActions message={last} className="mt-5 hidden md:flex md:pl-12" /> : null}
        </div>
      </PaneScroll>
      {last ? (
        <div className="border-t border-border bg-background px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
          <ReplyActions message={last} compact />
        </div>
      ) : null}
    </>
  );
}

export function ThreadReader({ threadId, view }: { threadId: string; view: string }) {
  const t = useTranslations("reader");
  const tm = useTranslations("mail.actions");
  const tc = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const thread = useThread(threadId);
  const accounts = useAccounts();
  const actions = useThreadActions();
  const { run } = actions;

  const query = searchParams.toString();
  const listHref = `/mail/${view}${query ? `?${query}` : ""}`;
  const unified = !searchParams.get("account");

  // Opening a conversation marks it read, once per conversation.
  const markedRef = useRef<string | null>(null);
  const isUnread = thread.data?.is_unread ?? false;
  useEffect(() => {
    if (isUnread && markedRef.current !== threadId) {
      markedRef.current = threadId;
      run("mark_read", [threadId], { silent: true });
    }
  }, [isUnread, threadId, run]);

  const leave = (action: ThreadAction) => {
    run(action, [threadId]);
    router.push(listHref);
  };

  const data = thread.data;
  const inTrash = view === "trash";
  const inSpam = view === "spam";
  const inArchive = view === "archive";

  // Archive and spam depend on the mailbox (an IMAP account may have no such folder): the
  // controls are left out, not offered and then rejected by the server.
  const can = (action: ThreadAction) => Boolean(data) && isActionAvailable(action, accounts.data, data ? [data.account_id] : []);
  const spamAction: ThreadAction = inSpam ? "not_spam" : "spam";

  const menu: MenuItem[] = [
    { key: "unread", label: tm("mark_unread"), icon: Mail, onSelect: () => leave("mark_unread") },
    ...(can(spamAction)
      ? [
          inSpam
            ? { key: "not_spam", label: tm("not_spam"), icon: ShieldCheck, onSelect: () => leave("not_spam") }
            : { key: "spam", label: tm("spam"), icon: OctagonAlert, onSelect: () => leave("spam") },
        ]
      : []),
  ];

  return (
    <Pane className="h-full flex-1 bg-background">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 pt-safe md:px-4">
        <Tooltip label={t("back")}>
          <Button asChild variant="ghost" size="icon" className="split:hidden">
            <Link href={listHref} aria-label={t("back")}>
              <ArrowLeft />
            </Link>
          </Button>
        </Tooltip>
        <div className="ml-auto flex items-center gap-0.5 split:ml-0">
          {inTrash ? (
            <ToolbarButton label={tm("restore")} onClick={() => leave("restore")}>
              <RotateCcw />
            </ToolbarButton>
          ) : inArchive ? (
            can("unarchive") ? (
              <ToolbarButton label={tm("unarchive")} onClick={() => leave("unarchive")}>
                <Inbox />
              </ToolbarButton>
            ) : null
          ) : !inSpam && can("archive") ? (
            <ToolbarButton label={tm("archive")} onClick={() => leave("archive")}>
              <Archive />
            </ToolbarButton>
          ) : null}
          {!inTrash ? (
            <ToolbarButton label={tm("trash")} onClick={() => leave("trash")}>
              <Trash2 />
            </ToolbarButton>
          ) : null}
          <ToolbarButton
            label={data?.is_starred ? tm("unstar") : tm("star")}
            active={data?.is_starred}
            onClick={() => run(data?.is_starred ? "unstar" : "star", [threadId])}
          >
            <Star className={cn(data?.is_starred && "fill-warning text-warning")} />
          </ToolbarButton>
          <ResponsiveMenu
            title={t("moreActions")}
            items={menu}
            trigger={
              <Button variant="ghost" size="icon" aria-label={t("moreActions")}>
                <MoreHorizontal />
              </Button>
            }
          />
        </div>
      </div>

      {thread.isPending ? (
        <ReaderSkeleton />
      ) : thread.isError ? (
        isApiError(thread.error) && thread.error.status === 404 ? (
          <EmptyState
            icon={MailWarning}
            title={t("notFoundTitle")}
            description={t("notFoundDescription")}
            action={
              <Button asChild>
                <Link href={listHref}>{t("back")}</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            title={tc("loadFailedTitle")}
            description={tc("loadFailedDescription")}
            action={<Button onClick={() => void thread.refetch()}>{tc("retry")}</Button>}
          />
        )
      ) : (
        <ThreadBody thread={thread.data} unified={unified} />
      )}
    </Pane>
  );
}
