import type { InfiniteData } from "@tanstack/react-query";
import type { Page } from "@/infrastructure/api-client";
import type { ThreadAction, ThreadDetail, ThreadListFilter, ThreadSummary } from "../types";

/** Whether a thread stays visible in a list after an action was applied to it. */
export function staysInView(action: ThreadAction, view: string): boolean {
  switch (action) {
    case "archive":
      return view !== "inbox";
    case "unarchive":
      return view !== "archive";
    case "trash":
      return view === "trash";
    case "restore":
      return view !== "trash";
    case "spam":
      return view === "spam";
    case "not_spam":
      return view !== "spam";
    case "unstar":
      return view !== "starred";
    default:
      return true;
  }
}

export function applyActionToThread<T extends ThreadSummary>(thread: T, action: ThreadAction): T {
  switch (action) {
    case "mark_read":
      return { ...thread, is_unread: false };
    case "mark_unread":
      return { ...thread, is_unread: true };
    case "star":
      return { ...thread, is_starred: true };
    case "unstar":
      return { ...thread, is_starred: false };
    default:
      return thread;
  }
}

export function applyActionToDetail(thread: ThreadDetail, action: ThreadAction): ThreadDetail {
  const next = applyActionToThread(thread, action);
  if (action === "mark_read") {
    return { ...next, messages: next.messages.map((message) => ({ ...message, is_read: true })) };
  }
  return next;
}

export function applyActionToList(
  data: InfiniteData<Page<ThreadSummary>> | undefined,
  filter: ThreadListFilter,
  threadIds: ReadonlySet<string>,
  action: ThreadAction,
): InfiniteData<Page<ThreadSummary>> | undefined {
  if (!data) return data;
  const keep = staysInView(action, filter.view) && !(filter.unreadOnly && action === "mark_read");
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: keep
        ? page.items.map((thread) => (threadIds.has(thread.id) ? applyActionToThread(thread, action) : thread))
        : page.items.filter((thread) => !threadIds.has(thread.id)),
    })),
  };
}

export const INVERSE_ACTION: Partial<Record<ThreadAction, ThreadAction>> = {
  archive: "unarchive",
  trash: "restore",
  spam: "not_spam",
};
