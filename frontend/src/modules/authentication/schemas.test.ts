import { describe, expect, it } from "vitest";
import { changePasswordSchema, loginSchema, registerSchema, resetPasswordSchema, safeNextPath } from "./schemas";

function firstError(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }, field: string) {
  return result.error?.issues.find((issue) => issue.path[0] === field)?.message;
}

describe("auth schemas", () => {
  it("requires a valid email and a password to sign in", () => {
    expect(loginSchema.safeParse({ email: " user@example.com ", password: "x" }).success).toBe(true);
    expect(firstError(loginSchema.safeParse({ email: "", password: "x" }), "email")).toBe("required");
    expect(firstError(loginSchema.safeParse({ email: "not-an-email", password: "x" }), "email")).toBe("emailInvalid");
    expect(firstError(loginSchema.safeParse({ email: "a@b.co", password: "" }), "password")).toBe("required");
  });

  it("enforces the password policy on registration", () => {
    const base = { display_name: "Olena", email: "olena@example.com" };
    expect(firstError(registerSchema.safeParse({ ...base, password: "short", confirm_password: "short" }), "password")).toBe("passwordTooShort");
    expect(firstError(registerSchema.safeParse({ ...base, password: "a".repeat(129), confirm_password: "a".repeat(129) }), "password")).toBe("passwordTooLong");
    expect(firstError(registerSchema.safeParse({ ...base, password: "long-enough-1", confirm_password: "different-12" }), "confirm_password")).toBe("passwordMismatch");
    expect(registerSchema.safeParse({ ...base, password: "long-enough-1", confirm_password: "long-enough-1" }).success).toBe(true);
    expect(firstError(registerSchema.safeParse({ ...base, display_name: "  ", password: "long-enough-1", confirm_password: "long-enough-1" }), "display_name")).toBe("required");
  });

  it("requires matching passwords when resetting or changing", () => {
    expect(firstError(resetPasswordSchema.safeParse({ new_password: "long-enough-1", confirm_password: "nope" }), "confirm_password")).toBe("passwordMismatch");
    expect(firstError(changePasswordSchema.safeParse({ current_password: "", new_password: "long-enough-1", confirm_password: "long-enough-1" }), "current_password")).toBe("required");
  });
});

describe("safeNextPath", () => {
  it("accepts same-site relative paths only", () => {
    expect(safeNextPath("/mail/inbox")).toBe("/mail/inbox");
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("/\\evil.example")).toBeNull();
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
  });
});
