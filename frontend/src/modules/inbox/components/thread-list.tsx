"use client";

import { Filter, Inbox, Menu, SearchX, Search as SearchIcon } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectAccountPrompt, SyncButton, accountLabel, useAccounts } from "@/modules/accounts";
import { isActionAvailable, useThreadActions, useThreadList, type ThreadAction, type ThreadListFilter } from "@/modules/emails";
import { parseMailView, useFolders } from "@/modules/folders";
import { SearchBox } from "@/modules/search";
import { Skeleton } from "@/shared/components/feedback/skeleton";
import { Spinner } from "@/shared/components/feedback/spinner";
import { EmptyState, ErrorState } from "@/shared/components/feedback/states";
import { useShell } from "@/shared/components/layout/app-shell";
import { Pane, PaneScroll } from "@/shared/components/layout/pane";
import { Button } from "@/shared/components/ui/button";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";
import { ThreadRow } from "./thread-row";

function ListSkeleton() {
  return (
    <ul aria-hidden>
      {Array.from({ length: 8 }, (_, index) => (
        <li key={index} className="flex min-h-[76px] flex-col justify-center gap-2 border-b border-border px-4 md:min-h-16">
          <div className="flex items-center gap-3">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="ml-auto h-3 w-10" />
          </div>
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </li>
      ))}
    </ul>
  );
}

export function ThreadList() {
  const t = useTranslations("mail");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const shell = useShell();
  const params = useParams<{ view: string; threadId?: string }>();
  const searchParams = useSearchParams();
  const accountId = searchParams.get("account");
  const queryText = searchParams.get("q");
  const view = parseMailView(params.view);
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
  const colorByAccount = useMemo(
    () => new Map((accounts.data ?? []).map((item) => [item.id, item.color])),
    [accounts.data],
  );

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
  const query = searchParams.toString();
  const suffix = query ? `?${query}` : "";
  const searchPending = view.kind === "search" && !queryText?.trim();

  return (
    <Pane className="h-full w-full bg-surface">
      <header className="shrink-0 border-b border-border pt-safe">
        <div className="flex h-14 min-w-0 items-center gap-1 pr-2 pl-2 md:pl-4">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={tn("openMenu")} onClick={shell.openDrawer}>
            <Menu />
          </Button>
          <div className="min-w-0 flex-1 pl-1 md:pl-0">
            <h1 className="truncate text-base leading-tight font-semibold text-foreground">{title}</h1>
            {subtitle ? <p className="truncate text-xs text-foreground-subtle">{subtitle}</p> : null}
          </div>
          {view.kind !== "search" ? (
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
          ) : null}
          {hasAccounts ? <SyncButton accountId={accountId} /> : null}
        </div>
        <div className={cn("px-3 pb-3", view.kind === "search" ? "block" : "hidden md:block")}>
          <SearchBox autoFocus={view.kind === "search" && !queryText} />
        </div>
      </header>

      {accounts.isSuccess && !hasAccounts ? (
        <ConnectAccountPrompt />
      ) : searchPending ? (
        <EmptyState icon={SearchIcon} title={t("searchPromptTitle")} description={t("searchPromptDescription")} />
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
        view.kind === "search" ? (
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
            {threads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                href={`/mail/${view.slug}/${thread.id}${suffix}`}
                selected={params.threadId === thread.id}
                view={filter.view}
                accountColor={colorByAccount.get(thread.account_id)}
                showAccount={!accountId && (accounts.data?.length ?? 0) > 1}
                canArchive={isActionAvailable("archive", accounts.data, [thread.account_id])}
                onAction={onAction}
              />
            ))}
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
