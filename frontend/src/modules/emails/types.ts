import { z } from "zod";
import { attachmentSchema } from "@/modules/attachments";
import { addressSchema } from "@/shared/types/address";

export const threadSummarySchema = z.object({
  id: z.string(),
  account_id: z.string(),
  subject: z.string().nullable().transform((value) => value ?? ""),
  snippet: z.string().nullable().transform((value) => value ?? ""),
  participants: z.array(addressSchema),
  message_count: z.number(),
  has_attachments: z.boolean(),
  is_unread: z.boolean(),
  is_starred: z.boolean(),
  last_message_at: z.string(),
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;

export const messageSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  account_id: z.string(),
  from: addressSchema,
  to: z.array(addressSchema),
  cc: z.array(addressSchema),
  bcc: z.array(addressSchema),
  reply_to: z.array(addressSchema).default([]),
  subject: z.string().nullable().transform((value) => value ?? ""),
  snippet: z.string().nullable().transform((value) => value ?? ""),
  sent_at: z.string(),
  is_read: z.boolean(),
  is_starred: z.boolean(),
  is_draft: z.boolean(),
  body_html: z.string().nullable(),
  body_text: z.string().nullable(),
  has_remote_images: z.boolean(),
  attachments: z.array(attachmentSchema),
});
export type Message = z.infer<typeof messageSchema>;

export const threadDetailSchema = threadSummarySchema.extend({ messages: z.array(messageSchema) });
export type ThreadDetail = z.infer<typeof threadDetailSchema>;

export const THREAD_ACTIONS = [
  "mark_read",
  "mark_unread",
  "star",
  "unstar",
  "archive",
  "unarchive",
  "trash",
  "restore",
  "spam",
  "not_spam",
] as const;
export type ThreadAction = (typeof THREAD_ACTIONS)[number];

export interface ThreadListFilter {
  view: string;
  accountId: string | null;
  folderId: string | null;
  query: string | null;
  unreadOnly: boolean;
}
