import { z } from "zod";
import { ACCENT_COLORS, ACCOUNT_TINTS, LIST_DENSITIES, READER_TEXT_SIZES } from "@/shared/lib/interface-preferences";

/** Seconds a send is held so it can be undone; 0 turns the undo window off. */
export const UNDO_SEND_SECONDS = [0, 5, 10, 20, 30] as const;
export type UndoSendSeconds = (typeof UNDO_SEND_SECONDS)[number];

export const settingsSchema = z.object({
  locale: z.enum(["en", "uk"]),
  theme: z.enum(["system", "light", "dark"]),
  load_remote_images: z.boolean(),
  conversation_view: z.boolean(),
  list_density: z.enum(LIST_DENSITIES),
  list_preview_lines: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  show_avatars: z.boolean(),
  account_tint: z.enum(ACCOUNT_TINTS),
  accent_color: z.enum(ACCENT_COLORS),
  reader_text_size: z.enum(READER_TEXT_SIZES),
  undo_send_seconds: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(20), z.literal(30)]),
});
export type Settings = z.infer<typeof settingsSchema>;
