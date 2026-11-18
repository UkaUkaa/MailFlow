"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/infrastructure/api-client";
import { assistantSchema, replyDraftSchema, type AiProvider, type Assistant } from "../types";

export const assistantKeys = { config: ["assistant"] as const };

/** The user's own AI connection (provider, model, last four characters of the key). */
export function useAssistant() {
  return useQuery({
    queryKey: assistantKeys.config,
    queryFn: ({ signal }) => api.get("/assistant", assistantSchema, { signal }),
    staleTime: 5 * 60_000,
  });
}

function useSetting<V>(mutationFn: (variables: V) => Promise<Assistant>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (assistant) => queryClient.setQueryData(assistantKeys.config, assistant),
  });
}

/** Checks the key with the provider and stores it encrypted on the server. */
export function useConnectAssistant() {
  return useSetting((body: { provider: AiProvider; api_key: string }) => api.put("/assistant", assistantSchema, body));
}

export function useChooseModel() {
  return useSetting((model: string) => api.patch("/assistant", assistantSchema, { model }));
}

export function useDisconnectAssistant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/assistant"),
    onSuccess: () => queryClient.setQueryData<Assistant>(assistantKeys.config, { configured: false, provider: null, model: null, key_hint: null, models: [] }),
  });
}

export function draftReply(sourceMessageId: string, instruction: string) {
  return api.post("/assistant/reply", replyDraftSchema, { source_message_id: sourceMessageId, instruction });
}

export function useDraftReply() {
  return useMutation({
    mutationFn: ({ sourceMessageId, instruction }: { sourceMessageId: string; instruction: string }) =>
      draftReply(sourceMessageId, instruction),
  });
}
