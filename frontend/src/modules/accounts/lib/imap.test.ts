import { describe, expect, it } from "vitest";
import { ApiError } from "@/infrastructure/api-client";
import en from "@/messages/en.json";
import uk from "@/messages/uk.json";
import {
  ALLOWED_PORTS,
  DEFAULT_PORTS,
  describeImapError,
  imapConnectDefaults,
  imapConnectSchema,
  imapCredentialsSchema,
  portAfterSecurityChange,
  rejectedImapFields,
  toImapConnectPayload,
  type ImapConnectValues,
} from "./imap";

type Issues = { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } };
function errorAt(result: Issues, path: string) {
  return result.error?.issues.find((issue) => issue.path.join(".") === path)?.message;
}

const valid: ImapConnectValues = {
  email_address: "me@example.com",
  display_name: "Work",
  imap: { host: "imap.example.com", port: 993, security: "ssl" },
  smtp: { host: "smtp.example.com", port: 587, security: "starttls" },
  username: "me@example.com",
  password: "app password 123",
};

describe("imapConnectSchema", () => {
  it("defaults to IMAP 993 with SSL and SMTP 587 with STARTTLS, and nothing else filled in", () => {
    expect(imapConnectDefaults()).toEqual({
      email_address: "",
      display_name: "",
      imap: { host: "", port: 993, security: "ssl" },
      smtp: { host: "", port: 587, security: "starttls" },
      username: "",
      password: "",
    });
  });

  it("accepts a complete form and trims everything except the password", () => {
    const result = imapConnectSchema.safeParse({
      ...valid,
      email_address: "  me@example.com ",
      display_name: " Work ",
      imap: { ...valid.imap, host: " imap.example.com " },
      username: " me@example.com ",
      password: " keeps its spaces ",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ...valid, password: " keeps its spaces " });
  });

  it("requires the email, both servers, the username and the password", () => {
    const result = imapConnectSchema.safeParse(imapConnectDefaults());
    expect(errorAt(result, "email_address")).toBe("required");
    expect(errorAt(result, "imap.host")).toBe("required");
    expect(errorAt(result, "smtp.host")).toBe("required");
    expect(errorAt(result, "username")).toBe("required");
    expect(errorAt(result, "password")).toBe("required");
    // The display name is optional.
    expect(errorAt(result, "display_name")).toBeUndefined();
  });

  it("rejects an invalid email address and over-long values", () => {
    expect(errorAt(imapConnectSchema.safeParse({ ...valid, email_address: "nope" }), "email_address")).toBe("emailInvalid");
    expect(errorAt(imapConnectSchema.safeParse({ ...valid, display_name: "x".repeat(101) }), "display_name")).toBe("displayNameTooLong");
    expect(imapConnectSchema.safeParse({ ...valid, display_name: "x".repeat(100) }).success).toBe(true);
    expect(errorAt(imapConnectSchema.safeParse({ ...valid, username: "x".repeat(256) }), "username")).toBe("usernameTooLong");
    expect(errorAt(imapConnectSchema.safeParse({ ...valid, password: "x".repeat(1025) }), "password")).toBe("mailPasswordTooLong");
    expect(imapConnectSchema.safeParse({ ...valid, password: "x".repeat(1024) }).success).toBe(true);
  });

  it("accepts only a bare server name as host", () => {
    for (const host of ["imap://imap.example.com", "imap.example.com:993", "imap.example.com/inbox", "imap example.com", "me@example.com"]) {
      expect(errorAt(imapConnectSchema.safeParse({ ...valid, imap: { ...valid.imap, host } }), "imap.host"), host).toBe("hostInvalid");
    }
    expect(errorAt(imapConnectSchema.safeParse({ ...valid, smtp: { ...valid.smtp, host: "x".repeat(254) } }), "smtp.host")).toBe("hostInvalid");
    expect(imapConnectSchema.safeParse({ ...valid, imap: { ...valid.imap, host: "mail.пошта.укр" } }).success).toBe(true);
  });

  it("accepts only the ports the server allows", () => {
    expect([...ALLOWED_PORTS.imap].sort()).toEqual([143, 993]);
    expect([...ALLOWED_PORTS.smtp].sort()).toEqual([465, 587]);
    for (const port of ALLOWED_PORTS.imap) {
      expect(imapConnectSchema.safeParse({ ...valid, imap: { ...valid.imap, port } }).success).toBe(true);
    }
    for (const port of ALLOWED_PORTS.smtp) {
      expect(imapConnectSchema.safeParse({ ...valid, smtp: { ...valid.smtp, port } }).success).toBe(true);
    }
    expect(errorAt(imapConnectSchema.safeParse({ ...valid, imap: { ...valid.imap, port: 25 } }), "imap.port")).toBe("portInvalid");
    expect(errorAt(imapConnectSchema.safeParse({ ...valid, smtp: { ...valid.smtp, port: 993 } }), "smtp.port")).toBe("portInvalid");
    expect(errorAt(imapConnectSchema.safeParse({ ...valid, smtp: { ...valid.smtp, port: 25 } }), "smtp.port")).toBe("portInvalid");
  });

  it("accepts only SSL or STARTTLS", () => {
    expect(errorAt(imapConnectSchema.safeParse({ ...valid, imap: { ...valid.imap, security: "none" } }), "imap.security")).toBe("required");
  });

  it("requires a password to reconnect", () => {
    expect(errorAt(imapCredentialsSchema.safeParse({ password: "" }), "password")).toBe("required");
    expect(imapCredentialsSchema.safeParse({ password: "x" }).success).toBe(true);
  });
});

describe("portAfterSecurityChange", () => {
  it("moves a default port to the default of the new security mode", () => {
    expect(portAfterSecurityChange("imap", "ssl", "starttls", 993)).toBe(143);
    expect(portAfterSecurityChange("imap", "starttls", "ssl", 143)).toBe(993);
    expect(portAfterSecurityChange("smtp", "starttls", "ssl", 587)).toBe(465);
    expect(portAfterSecurityChange("smtp", "ssl", "starttls", 465)).toBe(587);
  });

  it("keeps a port the user chose against the default", () => {
    expect(portAfterSecurityChange("imap", "ssl", "starttls", 143)).toBe(143);
    expect(portAfterSecurityChange("smtp", "starttls", "ssl", 465)).toBe(465);
    expect(portAfterSecurityChange("smtp", "ssl", "starttls", 587)).toBe(587);
  });

  it("uses the documented defaults", () => {
    expect(DEFAULT_PORTS).toEqual({ imap: { ssl: 993, starttls: 143 }, smtp: { ssl: 465, starttls: 587 } });
  });
});

describe("toImapConnectPayload", () => {
  it("builds exactly the request body of the contract", () => {
    expect(toImapConnectPayload(valid)).toEqual({
      email_address: "me@example.com",
      display_name: "Work",
      imap: { host: "imap.example.com", port: 993, security: "ssl" },
      smtp: { host: "smtp.example.com", port: 587, security: "starttls" },
      username: "me@example.com",
      password: "app password 123",
    });
  });

  it("omits an empty display name", () => {
    expect(toImapConnectPayload({ ...valid, display_name: "" })).not.toHaveProperty("display_name");
  });
});

describe("describeImapError", () => {
  const failure = (code: string, details: { field?: string; code?: string }[] = [], status = 422, retryAfter: number | null = null) =>
    new ApiError(status, code, "x", details, retryAfter);

  it("names the server that failed when the details say so", () => {
    for (const code of ["authentication_failed", "tls_required", "connection_failed", "blocked_destination"] as const) {
      expect(describeImapError(failure(code, [{ field: "imap", code }]))).toEqual({ key: `${code}.imap` });
      expect(describeImapError(failure(code, [{ field: "smtp", code }]))).toEqual({ key: `${code}.smtp` });
      expect(describeImapError(failure(code))).toEqual({ key: `${code}.any` });
      expect(describeImapError(failure(code, [{ field: "elsewhere", code }]))).toEqual({ key: `${code}.any` });
    }
  });

  it("maps the remaining codes of the contract", () => {
    expect(describeImapError(failure("validation_error", [{ field: "imap.host", code: "invalid" }]))).toEqual({ key: "validation_error" });
    expect(describeImapError(failure("account_limit_reached", [], 409))).toEqual({ key: "account_limit_reached" });
    expect(describeImapError(failure("not_found", [], 404))).toEqual({ key: "not_found" });
    expect(describeImapError(new ApiError(0, "network_error", "x"))).toEqual({ key: "network_error" });
  });

  it("tells how long to wait when the rate limit says so", () => {
    expect(describeImapError(failure("rate_limited", [], 429, 1800))).toEqual({ key: "rate_limited_minutes", values: { minutes: 30 } });
    expect(describeImapError(failure("rate_limited", [], 429, 61))).toEqual({ key: "rate_limited_minutes", values: { minutes: 2 } });
    expect(describeImapError(failure("rate_limited", [], 429))).toEqual({ key: "rate_limited" });
  });

  it("falls back to a generic message for anything else", () => {
    expect(describeImapError(failure("internal_error", [], 500))).toEqual({ key: "unknown" });
    expect(describeImapError(new Error("boom"))).toEqual({ key: "unknown" });
  });

  it("has a message for every key in both locales", () => {
    const keys = [
      ...(["authentication_failed", "tls_required", "connection_failed", "blocked_destination"] as const).flatMap((code) =>
        (["imap", "smtp", "any"] as const).map((server) => [code, server] as const),
      ),
    ];
    for (const messages of [en, uk]) {
      const errors = messages.accounts.imap.errors;
      for (const [code, server] of keys) expect(errors[code][server], `${code}.${server}`).toBeTruthy();
      for (const key of ["validation_error", "account_limit_reached", "rate_limited", "rate_limited_minutes", "not_found", "network_error", "unknown"] as const) {
        expect(errors[key], key).toBeTruthy();
      }
    }
  });
});

describe("rejectedImapFields", () => {
  it("returns the form fields a validation error names, and nothing for other errors", () => {
    const error = new ApiError(422, "validation_error", "x", [
      { field: "imap.host", code: "invalid" },
      { field: "email_address", code: "invalid" },
      { field: "something_else", code: "invalid" },
    ]);
    expect(rejectedImapFields(error)).toEqual(["email_address", "imap.host"]);
    expect(rejectedImapFields(new ApiError(422, "authentication_failed", "x", [{ field: "imap" }]))).toEqual([]);
    expect(rejectedImapFields(new Error("boom"))).toEqual([]);
  });
});
