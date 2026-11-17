"use client";

import { z } from "zod";
import { api } from "@/infrastructure/api-client";
import { draftSchema, type DraftRequest, type SendRequest } from "../types";

const sentSchema = z.object({ message_id: z.string(), thread_id: z.string().nullable().optional() });

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
 * session, so a retried or double-clicked send can never deliver twice.
 */
export function sendEmail(payload: SendRequest, files: File[], idempotencyKey: string) {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  for (const file of files) form.append("files", file, file.name);
  return api.post("/emails/send", sentSchema, form, { headers: { "Idempotency-Key": idempotencyKey } });
}
