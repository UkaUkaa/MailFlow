import { z } from "zod";

/** The AI services a user can connect with their own key. */
export const AI_PROVIDERS = ["openai", "anthropic", "gemini"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Where each provider hands out API keys, and what its keys usually start with. */
export const PROVIDER_INFO: Record<AiProvider, { keyUrl: string; keyPlaceholder: string }> = {
  openai: { keyUrl: "https://platform.openai.com/api-keys", keyPlaceholder: "sk-…" },
  anthropic: { keyUrl: "https://console.anthropic.com/settings/keys", keyPlaceholder: "sk-ant-…" },
  gemini: { keyUrl: "https://aistudio.google.com/apikey", keyPlaceholder: "AIza…" },
};

/** The user's AI connection. The key itself is never sent back, only its last four characters. */
export const assistantSchema = z.object({
  configured: z.boolean(),
  provider: z.enum(AI_PROVIDERS).nullable(),
  model: z.string().nullable(),
  key_hint: z.string().nullable(),
  models: z.array(z.string()),
});
export type Assistant = z.infer<typeof assistantSchema>;

export const replyDraftSchema = z.object({
  /** BCP 47 code of the language the reply was written in ("und" when unknown). */
  language: z.string(),
  /** Paragraphs and line breaks only; built and escaped by the server. */
  body_html: z.string(),
});
export type ReplyDraft = z.infer<typeof replyDraftSchema>;

export const ASSISTANT_INSTRUCTION_MAX = 2000;
export const API_KEY_MAX = 512;
