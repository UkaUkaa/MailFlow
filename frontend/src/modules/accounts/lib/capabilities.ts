import type { Account, Capabilities } from "../types";

export type CapabilityName = keyof Capabilities;

/**
 * Whether every one of the given mailboxes supports a capability. Capabilities are reported per
 * account (an IMAP mailbox without an Archive folder cannot archive), so an action that touches
 * several mailboxes is offered only when all of them support it. A mailbox that is not known
 * (yet) counts as unsupported: an action is never offered on a guess.
 */
export function accountsSupport(
  accounts: readonly Account[] | undefined,
  accountIds: Iterable<string>,
  capability: CapabilityName,
): boolean {
  if (!accounts) return false;
  let seen = false;
  for (const id of accountIds) {
    seen = true;
    const account = accounts.find((item) => item.id === id);
    if (!account || !account.capabilities[capability]) return false;
  }
  return seen;
}

/** Whether at least one mailbox supports a capability (used for views that span mailboxes). */
export function anyAccountSupports(accounts: readonly Account[], capability: CapabilityName): boolean {
  return accounts.some((account) => account.capabilities[capability]);
}
