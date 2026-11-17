import { z } from "zod";

export const attachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  size: z.number(),
  is_inline: z.boolean(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_FILES = 20;
