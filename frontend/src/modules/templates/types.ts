import { z } from "zod";

export const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  body_html: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Template = z.infer<typeof templateSchema>;

export const templateListSchema = z.object({ items: z.array(templateSchema) });

export interface TemplateInput {
  name: string;
  subject: string;
  body_html: string;
}

/** Limits mirrored from the API (the server validates them again). */
export const TEMPLATE_NAME_MAX = 100;
export const TEMPLATE_SUBJECT_MAX = 998;
