import { z } from "zod";

export const settingsSchema = z.object({
  locale: z.enum(["en", "uk"]),
  theme: z.enum(["system", "light", "dark"]),
  load_remote_images: z.boolean(),
  conversation_view: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
