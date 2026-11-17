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
}

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
}
