import type { Account, CapabilityName } from "@/modules/accounts";
import { accountsSupport } from "@/modules/accounts";
import type { ThreadAction } from "../types";

/** Mailbox capability an action needs. Actions that are not listed work on every mailbox. */
export const ACTION_CAPABILITY: Partial<Record<ThreadAction, CapabilityName>> = {
  archive: "archive",
  unarchive: "archive",
  spam: "spam",
  not_spam: "spam",
};

/**
 * Whether an action may be offered for threads of the given mailboxes: only when every one of
 * them supports it, so a control is hidden instead of failing with `422 unsupported`.
 */
export function isActionAvailable(
  action: ThreadAction,
  accounts: readonly Account[] | undefined,
  accountIds: Iterable<string>,
): boolean {
  const capability = ACTION_CAPABILITY[action];
  return capability ? accountsSupport(accounts, accountIds, capability) : true;
}
