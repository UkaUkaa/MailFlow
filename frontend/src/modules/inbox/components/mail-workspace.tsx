"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ReaderPlaceholder } from "@/modules/emails";
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
  const threadOpen = Boolean(params.threadId);

  useEffect(() => {
    rememberMailLocation(params.view, params.threadId, new URLSearchParams(searchParams.toString()));
  }, [params.view, params.threadId, searchParams]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className={cn(listPane, threadOpen ? "hidden" : "flex w-full")}>
        <ThreadList />
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col split:flex", threadOpen ? "flex" : "hidden")}>{children}</div>
    </div>
  );
}

/**
 * The mail workspace as a still background: the list the user last looked at and an empty
 * reading pane. Rendered, inert, behind a surface that covers the app (the settings dialog).
 */
export function MailBackdrop() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className={cn(listPane, "flex w-full")}>
        <ThreadList scope={lastMailList()} />
      </div>
      <div className="hidden min-h-0 min-w-0 flex-1 flex-col split:flex">
        <ReaderPlaceholder />
      </div>
    </div>
  );
}
