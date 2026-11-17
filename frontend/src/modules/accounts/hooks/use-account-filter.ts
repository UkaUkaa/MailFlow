"use client";

import { useSearchParams } from "next/navigation";
import { useAccounts } from "../api";
import type { Account } from "../types";

/** `?account=<id>` narrows the mail views to one mailbox; absent means unified. */
export function useAccountFilter(): { accountId: string | null; account: Account | null } {
  const searchParams = useSearchParams();
  const accountId = searchParams.get("account");
  const accounts = useAccounts();
  const account = accountId ? (accounts.data?.find((item) => item.id === accountId) ?? null) : null;
  return { accountId, account };
}
