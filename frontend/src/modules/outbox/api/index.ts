"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/infrastructure/api-client";
import { toServerLocalTime } from "@/shared/lib/user-time";
import { outboxDetailSchema, outboxItemSchema, outboxListSchema } from "../types";

export const outboxKeys = {
  all: ["outbox"] as const,
  list: () => ["outbox", "list"] as const,
};

/** How often the list is refreshed while something shows it (the worker sends in the background). */
const REFRESH_MS = 30_000;

export function fetchOutbox(signal?: AbortSignal) {
  return api.get("/outbox", outboxListSchema, { signal }).then((page) => page.items);
}

export function rescheduleOutboxItem(id: string, sendAt: Date) {
  return api.patch(`/outbox/${encodeURIComponent(id)}`, outboxItemSchema, { send_at: toServerLocalTime(sendAt) });
}

/** Stops a send that has not started yet and returns its full content. */
export function cancelOutboxItem(id: string) {
  return api.post(`/outbox/${encodeURIComponent(id)}/cancel`, outboxDetailSchema);
}

/** Scheduled (and failed) sends, soonest first. Shared by the Scheduled view and its badge. */
export function useOutbox(enabled = true) {
  return useQuery({
    queryKey: outboxKeys.list(),
    queryFn: ({ signal }) => fetchOutbox(signal),
    enabled,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

export function useRescheduleOutboxItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sendAt }: { id: string; sendAt: Date }) => rescheduleOutboxItem(id, sendAt),
    onSettled: () => queryClient.invalidateQueries({ queryKey: outboxKeys.all }),
  });
}

export function useCancelOutboxItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelOutboxItem(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: outboxKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
}
