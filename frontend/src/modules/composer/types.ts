import { z } from "zod";
import type { Attachment } from "@/modules/attachments";
import { addressSchema, type Address } from "@/shared/types/address";

export const composeModeSchema = z.enum(["new", "reply", "reply_all", "forward"]);
export type ComposeMode = z.infer<typeof composeModeSchema>;

export const draftSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  thread_id: z.string().nullable().optional(),
  to: z.array(addressSchema),
  cc: z.array(addressSchema),
  bcc: z.array(addressSchema),
  subject: z.string().nullable().transform((value) => value ?? ""),
  body_html: z.string().nullable().transform((value) => value ?? ""),
  mode: composeModeSchema.catch("new"),
  source_message_id: z.string().nullable().optional(),
  updated_at: z.string(),
});
export type Draft = z.infer<typeof draftSchema>;

export interface DraftRequest {
  account_id: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  body_html: string;
  mode: ComposeMode;
  source_message_id?: string;
}

export interface SendRequest extends DraftRequest {
  draft_id?: string;
  forward_attachment_ids?: string[];
  /** ISO-8601 UTC moment to send at ("Send later"); absent for an ordinary send. */
  send_at?: string;
}

/**
 * What the server did with a send: delivered it, is holding it for the undo window, or queued
 * it for a later time. The two held kinds can still be cancelled through the outbox.
 */
export const sendResultSchema = z.object({
  status: z.enum(["sent", "undoable", "scheduled"]),
  message_id: z.string().nullable(),
  thread_id: z.string().nullable(),
  outbox_id: z.string().nullable(),
  send_at: z.string().nullable(),
  undo_seconds: z.number(),
});
export type SendResult = z.infer<typeof sendResultSchema>;

/** Everything needed to open the composer. `key` doubles as the idempotency key for sending. */
export interface ComposeSession {
  key: string;
  mode: ComposeMode;
  accountId: string | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyHtml: string;
  /** Quoted original, appended on send but kept out of the editor so its markup survives. */
  quotedHtml: string | null;
  sourceMessageId: string | null;
  draftId: string | null;
  forwardAttachments: Attachment[];
  /** Files already attached: set when a cancelled send is reopened with what the user had picked. */
  files?: File[];
  /**
   * The content exists nowhere but in this session (a send that was cancelled): closing the
   * composer saves it as a draft, or asks first, even if the user changes nothing.
   */
  unsaved?: boolean;
}
