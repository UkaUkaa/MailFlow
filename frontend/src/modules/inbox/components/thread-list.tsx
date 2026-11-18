"use client";

import { ArrowLeft, Filter, Inbox, ListChecks, Menu, Search as SearchIcon, SearchX, SquarePen } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectAccountPrompt, SyncButton, accountAvatarUrl, accountLabel, useAccounts } from "@/modules/accounts";
import { useComposer } from "@/modules/composer";
import {
  isActionAvailable,
  staysInView,
  useThreadActions,
  useThreadList,
  type ThreadAction,
  type ThreadListFilter,
} from "@/modules/emails";
import { parseMailView, useFolders } from "@/modules/folders";
import { SearchBox, SearchSuggestions, searchHref } from "@/modules/search";
import { Link } from "@/infrastructure/i18n/navigation";
import { Skeleton } from "@/shared/components/feedback/skeleton";
import { Spinner } from "@/shared/components/feedback/spinner";
import { EmptyState, ErrorState } from "@/shared/components/feedback/states";
import { useShell } from "@/shared/components/layout/app-shell";
import { Pane, PaneScroll } from "@/shared/components/layout/pane";
import { Button } from "@/shared/components/ui/button";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";
import { lastMailList, mailListHref, type MailListScope } from "@/shared/lib/mail-location";
import { dateGroup, firstDayOfWeek, formatMonthGroup, type DateGroup } from "@/shared/utils/date-groups";
import { useThreadSelection } from "../hooks/use-thread-selection";
import { bulkActions } from "../lib/bulk-actions";
import { SelectionBar } from "./selection-bar";
import { ThreadRow } from "./thread-row";

function ListSkeleton() {
  return (
    <ul aria-hidden>
      {Array.from({ length: 8 }, (_, index) => (
        <li key={index} className="flex min-h-[88px] items-start gap-1 py-3 pr-5 pl-[30px] preview-none:min-h-[76px] compact:min-h-[60px] compact:py-2">
          <Skeleton className="mt-0.5 size-7 shrink-0 rounded-full no-avatars:hidden" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            <div className="flex items-center gap-3">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="ml-auto h-3 w-10" />
            </div>
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2 preview-none:hidden" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Round, bordered way back (search and folder views). */
const backButton =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong text-foreground-muted transition-colors hover:bg-muted hover:text-foreground touch:size-11 [&_svg]:size-4";

/**
 * The list pane: a header, then conversations grouped by date. In the `search` view the pane
 * becomes the search mode (field, suggestions, results). `scope` shows a fixed view instead of
 * the one in the URL; it is used for the list that stays visible behind the settings dialog.
 */
export function ThreadList({ scope }: { scope?: MailListScope }) {
  const t = useTranslations("mail");
  const tn = useTranslations("nav");
  const ts = useTranslations("search");
  const tc = useTranslations("common");
  const locale = useLocale();
  const shell = useShell();
  const composer = useComposer();
  const params = useParams<{ view?: string; threadId?: string }>();
  const searchParams = useSearchParams();
  const accountId = scope ? scope.accountId : searchParams.get("account");
  const queryText = scope ? null : searchParams.get("q");
  const view = parseMailView(scope?.view ?? params.view ?? "inbox");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const accounts = useAccounts();
  const hasAccounts = (accounts.data?.length ?? 0) > 0;
  const account = accountId ? accounts.data?.find((item) => item.id === accountId) : undefined;
  const folders = useFolders(accountId, view.kind === "folder" && Boolean(accountId));

  const isSearch = view.kind === "search";
  const folderId = view.kind === "folder" ? view.folderId : null;
  const viewSlug = view.slug;
  const filter = useMemo<ThreadListFilter>(
    () => ({
      view: viewSlug,
      accountId,
      folderId,
      query: isSearch ? queryText : null,
      unreadOnly: isSearch ? false : unreadOnly,
    }),
    [viewSlug, folderId, isSearch, accountId, queryText, unreadOnly],
  );
  const list = useThreadList(filter, hasAccounts);
  const { run } = useThreadActions();
  const onAction = useCallback((action: ThreadAction, threadId: string) => run(action, [threadId]), [run]);

  const threads = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);

  // Multi-selection: entered from the header ("Select") or by a long press on a row (touch).
  const selection = useThreadSelection(threads, JSON.stringify(filter));
  const { start: startSelection, stop: stopSelection, toggle: toggleSelection } = selection;
  const selectionActions = useMemo(
    () => bulkActions(filter.view, selection.selected, accounts.data),
    [filter.view, selection.selected, accounts.data],
  );
  const onBulkAction = (action: ThreadAction) => {
    run(action, selection.selected.map((thread) => thread.id));
    // Conversations that leave the view end the selection; read and star changes keep it, so
    // a further action can follow.
    if (!staysInView(action, filter.view) || (filter.unreadOnly && action === "mark_read")) stopSelection();
  };
  useEffect(() => {
    if (!selection.active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) stopSelection();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selection.active, stopSelection]);
  const appearanceByAccount = useMemo(
    () =>
      new Map(
        (accounts.data ?? []).map((item) => [item.id, { color: item.color, imageUrl: accountAvatarUrl(item) }]),
      ),
    [accounts.data],
  );

  // Date headings, in the browser's time zone. Search results are ordered by the server's
  // ranking rather than by date, so they are not grouped.
  const groups = useMemo<(DateGroup | null)[]>(() => {
    if (isSearch) return [];
    const now = new Date();
    const weekStartsOn = firstDayOfWeek(locale);
    return threads.map((thread) => dateGroup(thread.last_message_at, now, weekStartsOn));
  }, [threads, isSearch, locale]);
  const groupLabel = (group: DateGroup): string =>
    group.kind === "month" || group.kind === "monthYear" ? formatMonthGroup(group, locale) : t(`groups.${group.kind}`);

  // Infinite scrolling: fetch the next page when the sentinel approaches the viewport.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, threads.length]);

  const title =
    view.kind === "search"
      ? tn("search")
      : view.kind === "folder"
        ? (folders.data?.find((folder) => folder.id === view.folderId)?.name ?? tn("folder"))
        : tn(`views.${view.role}`);
  const subtitle = account ? accountLabel(account) : hasAccounts ? tn("allAccounts") : null;
  const query = scope ? (accountId ? `account=${encodeURIComponent(accountId)}` : "") : searchParams.toString();
  const suffix = query ? `?${query}` : "";
  const searchPending = isSearch && !queryText?.trim();
  const inboxHref = `/mail/inbox${accountId ? `?account=${encodeURIComponent(accountId)}` : ""}`;

  const menuButton = (
    <Button variant="ghost" size="icon" className="md:hidden" aria-label={tn("openMenu")} onClick={shell.openDrawer}>
      <Menu />
    </Button>
  );

  const selectButton = (
    <Tooltip label={t("selection.start")}>
      <Button variant="ghost" size="icon" aria-label={t("selection.start")} onClick={() => startSelection()}>
        <ListChecks />
      </Button>
    </Tooltip>
  );

  return (
    <Pane className="h-full w-full bg-surface">
      <header className="shrink-0 pt-safe">
        {selection.active ? (
          <SelectionBar
            count={selection.selected.length}
            allSelected={selection.allSelected}
            actions={selectionActions}
            onAction={onBulkAction}
            onToggleAll={selection.toggleAll}
            onCancel={stopSelection}
          />
        ) : isSearch ? (
          <div className="flex min-h-14 min-w-0 items-center gap-2 px-2 py-2 md:min-h-[76px] md:px-3">
            {menuButton}
            <Tooltip label={ts("close")}>
              <Link href={mailListHref(lastMailList())} aria-label={ts("close")} className={cn(backButton, "max-md:hidden")}>
                <ArrowLeft aria-hidden />
              </Link>
            </Tooltip>
            <h1 className="sr-only">{title}</h1>
            <SearchBox autoFocus={!queryText} className="flex-1" />
            {threads.length > 0 && !searchPending ? selectButton : null}
          </div>
        ) : (
          <div className="flex min-h-14 min-w-0 items-center gap-1 pr-2 pl-2 md:min-h-[76px] md:pr-3 md:pl-5">
            {menuButton}
            {view.kind === "folder" ? (
              <Tooltip label={t("backToInbox")}>
                <Link href={inboxHref} aria-label={t("backToInbox")} className={cn(backButton, "mr-2 max-md:hidden")}>
                  <ArrowLeft aria-hidden />
                </Link>
              </Tooltip>
            ) : null}
            <div className="min-w-0 flex-1 pl-1 md:pl-0">
              <h1 className="truncate text-base leading-tight font-semibold text-foreground md:text-sm">{title}</h1>
              {subtitle ? <p className="mt-0.5 truncate text-xs text-foreground-subtle md:text-[11px]">{subtitle}</p> : null}
            </div>
            <Tooltip label={unreadOnly ? t("showAll") : t("showUnread")}>
              <Button
                variant="ghost"
                size="icon"
                aria-pressed={unreadOnly}
                aria-label={t("showUnread")}
                onClick={() => setUnreadOnly((value) => !value)}
                className={cn(unreadOnly && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent")}
              >
                <Filter />
              </Button>
            </Tooltip>
            {threads.length > 0 && !scope ? selectButton : null}
            {hasAccounts ? <SyncButton accountId={accountId} /> : null}
            {/* Phones reach search and compose from the bottom navigation. */}
            <Tooltip label={tn("search")}>
              <Button asChild variant="ghost" size="icon" className="max-md:hidden">
                <Link href={searchHref("", accountId)} aria-label={tn("search")}>
                  <SearchIcon />
                </Link>
              </Button>
            </Tooltip>
            <Tooltip label={t("newMessage")}>
              <Button variant="ghost" size="icon" className="max-md:hidden" aria-label={t("newMessage")} onClick={composer.compose}>
                <SquarePen />
              </Button>
            </Tooltip>
          </div>
        )}
      </header>

      {accounts.isSuccess && !hasAccounts ? (
        <ConnectAccountPrompt />
      ) : searchPending ? (
        <SearchSuggestions />
      ) : list.isPending || accounts.isPending ? (
        <div role="status" aria-label={tc("loading")} className="min-h-0 flex-1 overflow-hidden">
          <ListSkeleton />
        </div>
      ) : list.isError || accounts.isError ? (
        <ErrorState
          title={tc("loadFailedTitle")}
          description={tc("loadFailedDescription")}
          action={<Button onClick={() => void (accounts.isError ? accounts.refetch() : list.refetch())}>{tc("retry")}</Button>}
        />
      ) : threads.length === 0 ? (
        isSearch ? (
          <EmptyState icon={SearchX} title={t("noResultsTitle")} description={t("noResultsDescription")} />
        ) : (
          <EmptyState
            icon={Inbox}
            title={unreadOnly ? t("emptyUnreadTitle") : t("emptyTitle")}
            description={unreadOnly ? t("emptyUnreadDescription") : t("emptyDescription")}
          />
        )
      ) : (
        <PaneScroll>
          <ul aria-label={title}>
            {threads.map((thread, index) => {
              const group = groups[index] ?? null;
              const heading = group && group.key !== groups[index - 1]?.key ? groupLabel(group) : null;
              return (
                <Fragment key={thread.id}>
                  {heading ? (
                    <li role="presentation" className={cn("px-5 pb-3", index === 0 ? "pt-2" : "pt-6")}>
                      <h2 className="text-[13px] text-foreground-subtle">{heading}</h2>
                    </li>
                  ) : null}
                  <ThreadRow
                    thread={thread}
                    href={`/mail/${view.slug}/${thread.id}${suffix}`}
                    selected={!scope && params.threadId === thread.id}
                    view={filter.view}
                    accountColor={appearanceByAccount.get(thread.account_id)?.color}
                    accountImageUrl={appearanceByAccount.get(thread.account_id)?.imageUrl}
                    showAccount={!accountId && (accounts.data?.length ?? 0) > 1}
                    canArchive={isActionAvailable("archive", accounts.data, [thread.account_id])}
                    onAction={onAction}
                    selectionMode={selection.active}
                    checked={selection.ids.has(thread.id)}
                    onToggleSelect={toggleSelection}
                    onLongPress={scope ? undefined : startSelection}
                  />
                </Fragment>
              );
            })}
          </ul>
          <div ref={sentinelRef} className="flex h-16 items-center justify-center pb-safe">
            {isFetchingNextPage ? (
              <Spinner label={tc("loading")} />
            ) : !hasNextPage ? (
              <span className="text-xs text-foreground-subtle">{t("endOfList")}</span>
            ) : null}
          </div>
        </PaneScroll>
      )}
    </Pane>
  );
}
