"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { isApiError } from "@/infrastructure/api-client";
import { cancelOutboxItem, outboxKeys } from "@/modules/outbox";
import { formatScheduleDate } from "@/shared/utils/format";
import { sessionAfterUndo } from "../lib/restore";
import type { ComposeSession, SendResult } from "../types";

/** How long the "Send scheduled" toast offers Undo. */
const SCHEDULED_TOAST_MS = 8_000;
const RESULT_TOAST_MS = 4_000;
/** The worker sends asynchronously, so the lists are refreshed once more a little later. */
const SECOND_REFRESH_MS = 3_000;

/** "Sending…" with a bar that empties over the undo window. */
function UndoCountdown({ label, durationMs }: { label: string; durationMs: number }) {
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <span className="break-words">{label}</span>
      <span aria-hidden className="block h-0.5 w-full overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full origin-left bg-accent motion-reduce:hidden"
          style={{ animation: `undo-countdown ${durationMs}ms linear forwards` }}
        />
      </span>
    </span>
  );
}

/**
 * What happens after the server accepted a send. It outlives the composer (which closes at
 * once): a delivered message is announced; a held one ("undoable" or "scheduled") gets a toast
 * with Undo, which cancels the send and hands the composer's state back through `reopen`.
 */
export function useSendOutcome(reopen: (session: ComposeSession) => void) {
  const t = useTranslations("composer");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["threads"] });
    void queryClient.invalidateQueries({ queryKey: ["folders"] });
    void queryClient.invalidateQueries({ queryKey: outboxKeys.all });
  }, [queryClient]);

  const later = useCallback((run: () => void, delayMs: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, delayMs);
    timers.current.add(timer);
    return timer;
  }, []);

  return useCallback(
    (result: SendResult, snapshot: ComposeSession) => {
      const outboxId = result.outbox_id;
      if (result.status === "sent" || !outboxId) {
        toast.success(t("sent"));
        refresh();
        return;
      }

      const toastId = `send-${outboxId}`;
      let settled = false;
      let elapse: ReturnType<typeof setTimeout> | undefined;

      const undo = async () => {
        if (settled) return;
        settled = true;
        if (elapse) {
          clearTimeout(elapse);
          timers.current.delete(elapse);
        }
        try {
          const detail = await cancelOutboxItem(outboxId);
          reopen(sessionAfterUndo(snapshot, detail.draft_id));
        } catch (cause) {
          const tooLate = isApiError(cause) && cause.code === "outbox_not_cancellable";
          toast.error(t(tooLate ? "undo.tooLate" : "undo.failed"), { duration: RESULT_TOAST_MS });
        } finally {
          refresh();
        }
      };
      const action = { label: t("undo.action"), onClick: () => void undo() };

      if (result.status === "undoable") {
        const windowMs = Math.max(result.undo_seconds, 1) * 1000;
        // Stays a moment longer than the window; the timer below replaces it when it elapses.
        toast(<UndoCountdown label={t("undo.sending")} durationMs={windowMs} />, { id: toastId, duration: windowMs + 2_000, action });
        elapse = later(() => {
          if (settled) return;
          settled = true;
          toast.success(t("sent"), { id: toastId, duration: RESULT_TOAST_MS, action: undefined });
          refresh();
          later(refresh, SECOND_REFRESH_MS);
        }, windowMs);
        return;
      }

      const date = formatScheduleDate(result.send_at ?? "", locale);
      toast(date ? t("scheduledFor", { date }) : t("scheduled"), { id: toastId, duration: SCHEDULED_TOAST_MS, action });
      refresh();
    },
    [t, locale, refresh, later, reopen],
  );
}
