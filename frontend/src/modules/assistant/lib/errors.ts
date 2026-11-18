import { isApiError } from "@/infrastructure/api-client";

export type AssistantErrorKey =
  | "notConfigured"
  | "keyInvalid"
  | "noModels"
  | "model"
  | "providerLimit"
  | "rateLimited"
  | "refused"
  | "unavailable"
  | "generic";

/** Which message to show for a failed assistant request. */
export function assistantErrorKey(error: unknown): AssistantErrorKey {
  if (!isApiError(error)) return "generic";
  switch (error.code) {
    case "assistant_not_configured":
      return "notConfigured";
    case "assistant_key_invalid":
      return "keyInvalid";
    case "assistant_no_models":
      return "noModels";
    case "assistant_model_unavailable":
    case "assistant_model_unsupported":
      return "model";
    case "assistant_rate_limited":
      return "providerLimit";
    case "rate_limited":
      return "rateLimited";
    case "assistant_refused":
      return "refused";
    case "assistant_unavailable":
      return "unavailable";
    default:
      return error.details.some((detail) => detail.field === "api_key") ? "keyInvalid" : "generic";
  }
}

/** Human name of the reply language in the interface language, or null when unknown. */
export function languageName(code: string, locale: string): string | null {
  if (!code || code === "und") return null;
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? null;
  } catch {
    return null;
  }
}
