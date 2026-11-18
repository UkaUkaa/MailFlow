"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";
import { errorKey } from "@/infrastructure/api-client";
import { useRouter } from "@/infrastructure/i18n/navigation";
import { accountKeys } from "@/modules/accounts";
import { useThreadAction } from "../api";
import { INVERSE_ACTION } from "../lib/optimistic";
import type { ThreadAction } from "../types";

const ANNOUNCED: ReadonlySet<ThreadAction> = new Set([
  "archive",
  "unarchive",
  "trash",
  "restore",
  "spam",
  "not_spam",
  "mark_unread",
]);

/** Failures with a cause the user can act on get their own message instead of the generic one. */
const EXPLAINED = new Set([
  "provider_auth_required",
  "provider_unavailable",
  "provider_rate_limited",
  "rate_limited",
  "unsupported",
  "network_error",
]);

/** Thread actions with user feedback: confirmation toast, undo where safe, error toast. */
export function useThreadActions() {
  const t = useTranslations("mail.actions");
  const te = useTranslations("errors");
  const ta = useTranslations("accounts");
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useThreadAction();
  const { mutateAsync } = mutation;

  const fail = useCallback(
    (error: unknown) => {
      const key = errorKey(error);
      if (key === "provider_auth_required") {
        // The server has marked the mailbox; refresh accounts so its "Reconnect" badge shows.
        void queryClient.invalidateQueries({ queryKey: accountKeys.all });
        toast.error(te(key), {
          action: { label: ta("reconnect"), onClick: () => router.push("/settings/accounts") },
        });
        return;
      }
      toast.error(EXPLAINED.has(key) ? te(key) : t("failed"));
    },
    [queryClient, router, t, ta, te],
  );

  const run = useCallback(
    (action: ThreadAction, threadIds: string[], options: { silent?: boolean } = {}) => {
      if (threadIds.length === 0) return;
      // Promise handlers (unlike per-call mutate callbacks) still run after the
      // calling component unmounts, e.g. when the reader navigates back to the list.
      mutateAsync({ threadIds, action, silent: options.silent }).then(
        () => {
          if (options.silent || !ANNOUNCED.has(action)) return;
          const inverse = INVERSE_ACTION[action];
          toast(t(`done.${action}`, { count: threadIds.length }), {
            action: inverse
              ? {
                  label: t("undo"),
                  onClick: () => {
                    mutateAsync({ threadIds, action: inverse }).catch(fail);
                  },
                }
              : undefined,
          });
        },
        fail,
      );
    },
    [mutateAsync, fail, t],
  );

  return { run, isPending: mutation.isPending };
}
