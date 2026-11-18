"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/infrastructure/api-client";
import { draftSchema, sendResultSchema, type DraftRequest, type SendRequest } from "../types";

export function createDraft(body: DraftRequest) {
  return api.post("/emails/drafts", draftSchema, body);
}

export function updateDraft(draftId: string, body: DraftRequest) {
  return api.put(`/emails/drafts/${encodeURIComponent(draftId)}`, draftSchema, body);
}

export function fetchDraft(draftId: string) {
  return api.get(`/emails/drafts/${encodeURIComponent(draftId)}`, draftSchema);
}

export function deleteDraft(draftId: string) {
  return api.delete(`/emails/drafts/${encodeURIComponent(draftId)}`);
}

/**
 * Sends a message. `idempotencyKey` is fixed for the lifetime of one compose
 * session, so a retried or double-clicked send can never deliver twice. With `send_at` in the
 * payload the message is scheduled; otherwise it is sent now or held for the undo window.
 */
export function sendEmail(payload: SendRequest, files: File[], idempotencyKey: string) {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  for (const file of files) form.append("files", file, file.name);
  return api.post("/emails/send", sendResultSchema, form, { headers: { "Idempotency-Key": idempotencyKey } });
}

/** Deletes a stored draft and refreshes the lists and conversations that showed it. */
export function useDeleteDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draftId: string) => deleteDraft(draftId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
}
