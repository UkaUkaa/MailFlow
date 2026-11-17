import { z } from "zod";
import { isApiError } from "@/infrastructure/api-client";

export const MAIL_SECURITIES = ["ssl", "starttls"] as const;
export type MailSecurity = (typeof MAIL_SECURITIES)[number];
export type MailServerKind = "imap" | "smtp";

/** Protocol names, not interface copy: they are written the same way in every language. */
export const SECURITY_LABELS: Record<MailSecurity, string> = { ssl: "SSL/TLS", starttls: "STARTTLS" };
export const HOST_PLACEHOLDERS: Record<MailServerKind, string> = { imap: "imap.example.com", smtp: "smtp.example.com" };

/** The only ports the server accepts, keyed by the security mode each one is the default for. */
export const DEFAULT_PORTS = {
  imap: { ssl: 993, starttls: 143 },
  smtp: { ssl: 465, starttls: 587 },
} as const satisfies Record<MailServerKind, Record<MailSecurity, number>>;

export const ALLOWED_PORTS = {
  imap: [993, 143],
  smtp: [587, 465],
} as const satisfies Record<MailServerKind, readonly number[]>;

/**
 * Port to use after the security mode changed. A port that was the default for the previous
 * mode follows the new mode; a combination the user chose on purpose is left alone.
 */
export function portAfterSecurityChange(
  kind: MailServerKind,
  previous: MailSecurity,
  next: MailSecurity,
  currentPort: number,
): number {
  return currentPort === DEFAULT_PORTS[kind][previous] ? DEFAULT_PORTS[kind][next] : currentPort;
}

/** Error messages are keys in the `validation` message namespace. */
const host = z
  .string()
  .trim()
  .min(1, "required")
  .max(253, "hostInvalid")
  // A bare server name: no scheme, path, port or whitespace.
  .regex(/^[^\s/:@]+$/, "hostInvalid");
const security = z.enum(MAIL_SECURITIES, "required");
const password = z.string().min(1, "required").max(1024, "mailPasswordTooLong");

export const imapConnectSchema = z.object({
  email_address: z.string().trim().min(1, "required").pipe(z.email("emailInvalid")),
  display_name: z.string().trim().max(100, "displayNameTooLong"),
  imap: z.object({ host, port: z.literal([...ALLOWED_PORTS.imap], "portInvalid"), security }),
  smtp: z.object({ host, port: z.literal([...ALLOWED_PORTS.smtp], "portInvalid"), security }),
  username: z.string().trim().min(1, "required").max(255, "usernameTooLong"),
  password,
});
export type ImapConnectValues = z.infer<typeof imapConnectSchema>;

export function imapConnectDefaults(): ImapConnectValues {
  return {
    email_address: "",
    display_name: "",
    imap: { host: "", port: DEFAULT_PORTS.imap.ssl, security: "ssl" },
    smtp: { host: "", port: DEFAULT_PORTS.smtp.starttls, security: "starttls" },
    username: "",
    password: "",
  };
}

export const imapCredentialsSchema = z.object({ password });
export type ImapCredentialsValues = z.infer<typeof imapCredentialsSchema>;

export interface ImapConnectPayload {
  email_address: string;
  display_name?: string;
  imap: { host: string; port: number; security: MailSecurity };
  smtp: { host: string; port: number; security: MailSecurity };
  username: string;
  password: string;
}

/** Request body for `POST /accounts/imap`. The server rejects unknown fields, so nothing else is sent. */
export function toImapConnectPayload(values: ImapConnectValues): ImapConnectPayload {
  return {
    email_address: values.email_address,
    ...(values.display_name ? { display_name: values.display_name } : {}),
    imap: { host: values.imap.host, port: values.imap.port, security: values.imap.security },
    smtp: { host: values.smtp.host, port: values.smtp.port, security: values.smtp.security },
    username: values.username,
    password: values.password,
  };
}

const SERVER_ERRORS = ["authentication_failed", "tls_required", "connection_failed", "blocked_destination"] as const;
type ServerErrorCode = (typeof SERVER_ERRORS)[number];
const PLAIN_ERRORS = ["validation_error", "account_limit_reached", "not_found", "network_error"] as const;
type PlainErrorCode = (typeof PLAIN_ERRORS)[number];

/** A key under `accounts.imap.errors`, with the values its message needs. */
export type ImapErrorKey =
  | `${ServerErrorCode}.${MailServerKind | "any"}`
  | PlainErrorCode
  | "rate_limited"
  | "rate_limited_minutes"
  | "unknown";
export interface ImapErrorMessage {
  key: ImapErrorKey;
  values?: { minutes: number };
}

/** Maps a failed connect/reconnect call to a translatable message, naming the server that failed when known. */
export function describeImapError(error: unknown): ImapErrorMessage {
  if (!isApiError(error)) return { key: "unknown" };
  const serverCode = SERVER_ERRORS.find((code) => code === error.code);
  if (serverCode) {
    const field = error.details.find((detail) => detail.field === "imap" || detail.field === "smtp")?.field;
    return { key: `${serverCode}.${field === "imap" || field === "smtp" ? field : "any"}` };
  }
  if (error.code === "rate_limited") {
    return error.retryAfter && error.retryAfter > 0
      ? { key: "rate_limited_minutes", values: { minutes: Math.ceil(error.retryAfter / 60) } }
      : { key: "rate_limited" };
  }
  return { key: PLAIN_ERRORS.find((code) => code === error.code) ?? "unknown" };
}

export const IMAP_FORM_FIELDS = [
  "email_address",
  "display_name",
  "imap.host",
  "imap.port",
  "imap.security",
  "smtp.host",
  "smtp.port",
  "smtp.security",
  "username",
  "password",
] as const;
export type ImapFormField = (typeof IMAP_FORM_FIELDS)[number];

/** Form fields the server named in a `validation_error`, so each can be marked next to its input. */
export function rejectedImapFields(error: unknown): ImapFormField[] {
  if (!isApiError(error) || error.code !== "validation_error") return [];
  return IMAP_FORM_FIELDS.filter((field) => error.details.some((detail) => detail.field === field));
}
