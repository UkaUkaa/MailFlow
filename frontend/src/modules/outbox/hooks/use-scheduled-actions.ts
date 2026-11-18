"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";
import { isApiError } from "@/infrastructure/api-client";
import { formatScheduleDate } from "@/shared/utils/format";
import { useCancelOutboxItem, useRescheduleOutboxItem } from "../api";
import type { OutboxDetail, OutboxItem } from "../types";

type ErrorKey = "tooLate" | "notEditable" | "in_past" | "too_far" | "generic";

function errorKey(cause: unknown): ErrorKey {
  if (!isApiError(cause)) return "generic";
  if (cause.code === "outbox_not_cancellable") return "tooLate";
  if (cause.code === "outbox_not_editable") return "notEditable";
  const sendAt = cause.details.find((detail) => detail.field === "send_at")?.code;
  return sendAt === "in_past" || sendAt === "too_far" ? sendAt : "generic";
}

/**
 * Reschedule and cancel for the Scheduled view, with their feedback. A cancelled send is handed
 * to `onReopen` with its full content so the composer can open with it.
 */
export function useScheduledActions(onReopen: (detail: OutboxDetail) => void) {
  const t = useTranslations("outbox");
  const locale = useLocale();
  const rescheduleMutation = useRescheduleOutboxItem();
  const cancelMutation = useCancelOutboxItem();

  const reschedule = useCallback(
    (item: OutboxItem, sendAt: Date) => {
      rescheduleMutation.mutate(
        { id: item.id, sendAt },
        {
          onSuccess: (updated) => toast.success(t("rescheduled", { date: formatScheduleDate(updated.send_at, locale) })),
          onError: (cause) => toast.error(t(`errors.${errorKey(cause)}`)),
        },
      );
    },
    [rescheduleMutation, t, locale],
  );

  const cancel = useCallback(
    (item: OutboxItem) => {
      cancelMutation.mutate(item.id, {
        onSuccess: onReopen,
        onError: (cause) => toast.error(t(`errors.${errorKey(cause)}`)),
      });
    },
    [cancelMutation, onReopen, t],
  );

  const busyId = rescheduleMutation.isPending
    ? (rescheduleMutation.variables?.id ?? null)
    : cancelMutation.isPending
      ? (cancelMutation.variables ?? null)
      : null;

  return { reschedule, cancel, busyId };
}
