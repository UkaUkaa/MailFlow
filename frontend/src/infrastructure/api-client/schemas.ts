import { z } from "zod";

export function listSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable().optional().transform((value) => value ?? null),
  });
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export const statusSchema = z.object({ status: z.string() });
