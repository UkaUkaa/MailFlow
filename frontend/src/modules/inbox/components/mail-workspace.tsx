"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useComposer } from "@/modules/composer";
import { ReaderPlaceholder } from "@/modules/emails";
import { SCHEDULED_VIEW, ScheduledList } from "@/modules/outbox";
import { cn } from "@/shared/lib/cn";
import { lastMailList, rememberMailLocation } from "@/shared/lib/mail-location";
import { ThreadList } from "./thread-list";

/** The list pane is the raised column; panes are separated by tone, not by a line. */
const listPane = "min-h-0 min-w-0 flex-col split:flex split:w-[348px] split:shrink-0 3xl:w-[400px]";

/**
 * List + reader. Below the `split` breakpoint (900px) only one of them is
 * visible at a time, chosen by whether a conversation is open; from `split`
 * upwards they sit side by side. The switch is CSS-only.
 */
export function MailWorkspace({ children }: { children: ReactNode }) {
  const params = useParams<{ view: string; threadId?: string }>();
  const searchParams = useSearchParams();
  const composer = useComposer();
  // Scheduled sends have no reader of their own: the list is the whole view.
  const scheduled = params.view === SCHEDULED_VIEW;
  const threadOpen = Boolean(params.threadId) && !scheduled;

  useEffect(() => {
    rememberMailLocation(params.view, params.threadId, new URLSearchParams(searchParams.toString()));
  }, [params.view, params.threadId, searchParams]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className={cn(listPane, threadOpen ? "hidden" : "flex w-full")}>
        {scheduled ? <ScheduledList onReopen={composer.reopenCancelled} /> : <ThreadList />}
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col split:flex", threadOpen ? "flex" : "hidden")}>
        {scheduled ? <ReaderPlaceholder /> : children}
      </div>
    </div>
  );
}

/**
 * The mail workspace as a still background: the list the user last looked at and an empty
 * reading pane. Rendered, inert, behind a surface that covers the app (the settings dialog).
 */
export function MailBackdrop() {
  const scope = lastMailList();
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className={cn(listPane, "flex w-full")}>
        {scope.view === SCHEDULED_VIEW ? (
          <ScheduledList accountId={scope.accountId} onReopen={() => undefined} />
        ) : (
          <ThreadList scope={scope} />
        )}
      </div>
      <div className="hidden min-h-0 min-w-0 flex-1 flex-col split:flex">
        <ReaderPlaceholder />
      </div>
    </div>
  );
}
