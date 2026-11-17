"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";
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

/** Thread actions with user feedback: confirmation toast, undo where safe, error toast. */
export function useThreadActions() {
  const t = useTranslations("mail.actions");
  const mutation = useThreadAction();
  const { mutateAsync } = mutation;

  const run = useCallback(
    (action: ThreadAction, threadIds: string[], options: { silent?: boolean } = {}) => {
      if (threadIds.length === 0) return;
      // Promise handlers (unlike per-call mutate callbacks) still run after the
      // calling component unmounts, e.g. when the reader navigates back to the list.
      mutateAsync({ threadIds, action }).then(
        () => {
          if (options.silent || !ANNOUNCED.has(action)) return;
          const inverse = INVERSE_ACTION[action];
          toast(t(`done.${action}`, { count: threadIds.length }), {
            action: inverse
              ? {
                  label: t("undo"),
                  onClick: () => {
                    mutateAsync({ threadIds, action: inverse }).catch(() => toast.error(t("failed")));
                  },
                }
              : undefined,
          });
        },
        () => toast.error(t("failed")),
      );
    },
    [mutateAsync, t],
  );

  return { run, isPending: mutation.isPending };
}
