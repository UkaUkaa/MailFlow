import { z } from "zod";
import { addressSchema } from "@/shared/types/address";

const modeSchema = z.enum(["new", "reply", "reply_all", "forward"]).catch("new");

const outboxBase = {
  id: z.string(),
  account_id: z.string(),
  send_at: z.string(),
  created_at: z.string(),
  subject: z.string().nullable().transform((value) => value ?? ""),
  to: z.array(addressSchema),
  cc: z.array(addressSchema),
  bcc: z.array(addressSchema),
  snippet: z.string().nullable().transform((value) => value ?? ""),
  attachment_count: z.number(),
  mode: modeSchema,
  error_code: z.string().nullable(),
};

/** A scheduled send as the Scheduled view lists it. */
export const outboxItemSchema = z.object({
  ...outboxBase,
  status: z.enum(["pending", "sending", "failed"]),
});
export type OutboxItem = z.infer<typeof outboxItemSchema>;

export const outboxListSchema = z.object({ items: z.array(outboxItemSchema) });

/** One send with its full content; this is what a cancelled send hands back to the composer. */
export const outboxDetailSchema = z.object({
  ...outboxBase,
  status: z.enum(["pending", "sending", "failed", "sent", "cancelled"]),
  body_html: z.string().nullable().transform((value) => value ?? ""),
  source_message_id: z.string().nullable(),
  draft_id: z.string().nullable(),
  forward_attachment_ids: z.array(z.string()),
  attachments: z.array(z.object({ filename: z.string(), mime_type: z.string(), size: z.number() })),
});
export type OutboxDetail = z.infer<typeof outboxDetailSchema>;
