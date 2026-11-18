import type { Account } from "@/modules/accounts";
import { isActionAvailable, type ThreadAction, type ThreadSummary } from "@/modules/emails";

/**
 * Actions offered for a multi-selection, in toolbar order. Mirrors the reader toolbar for the
 * view; toggles (read, star) follow the selection: one unread conversation is enough to offer
 * "Mark as read", one unstarred conversation to offer "Star". Archive and spam appear only when
 * every selected conversation's mailbox supports them.
 */
export function bulkActions(
  view: string,
  selected: readonly ThreadSummary[],
  accounts: readonly Account[] | undefined,
): ThreadAction[] {
  if (selected.length === 0) return [];
  const accountIds = new Set(selected.map((thread) => thread.account_id));
  const can = (action: ThreadAction) => isActionAvailable(action, accounts, accountIds);
  const inTrash = view === "trash";
  const inSpam = view === "spam";
  const inArchive = view === "archive";

  const actions: ThreadAction[] = [];
  actions.push(selected.some((thread) => thread.is_unread) ? "mark_read" : "mark_unread");
  if (inArchive) {
    if (can("unarchive")) actions.push("unarchive");
  } else if (!inTrash && !inSpam && can("archive")) {
    actions.push("archive");
  }
  actions.push(inTrash ? "restore" : "trash");
  if (inSpam) {
    if (can("not_spam")) actions.push("not_spam");
  } else if (!inTrash && can("spam")) {
    actions.push("spam");
  }
  actions.push(selected.some((thread) => !thread.is_starred) ? "star" : "unstar");
  return actions;
}
