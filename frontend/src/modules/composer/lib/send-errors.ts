import { isApiError } from "@/infrastructure/api-client";

const KNOWN = [
  "payload_too_large",
  "provider_auth_required",
  "rate_limited",
  "provider_unavailable",
  "provider_rate_limited",
  "network_error",
  "too_many_scheduled",
] as const;

export type SendErrorKey = (typeof KNOWN)[number] | "send_at_in_past" | "send_at_too_far" | "unknown";

/** Maps a failed send to a key under `composer.errors.send`. */
export function sendErrorKey(cause: unknown): SendErrorKey {
  if (!isApiError(cause)) return "unknown";
  const sendAt = cause.details.find((detail) => detail.field === "send_at")?.code;
  if (sendAt === "in_past") return "send_at_in_past";
  if (sendAt === "too_far") return "send_at_too_far";
  return KNOWN.find((item) => item === cause.code) ?? "unknown";
}
