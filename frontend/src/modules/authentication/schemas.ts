import { z } from "zod";

/** Error messages are keys in the `validation` message namespace. */
const email = z.string().trim().min(1, "required").pipe(z.email("emailInvalid"));
const newPassword = z.string().min(10, "passwordTooShort").max(128, "passwordTooLong");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "required"),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    display_name: z.string().trim().min(1, "required").max(80, "nameTooLong"),
    email,
    password: newPassword,
    confirm_password: z.string().min(1, "required"),
  })
  .refine((values) => values.password === values.confirm_password, {
    path: ["confirm_password"],
    message: "passwordMismatch",
  });
export type RegisterValues = z.infer<typeof registerSchema>;

export const emailOnlySchema = z.object({ email });
export type EmailOnlyValues = z.infer<typeof emailOnlySchema>;

export const resetPasswordSchema = z
  .object({
    new_password: newPassword,
    confirm_password: z.string().min(1, "required"),
  })
  .refine((values) => values.new_password === values.confirm_password, {
    path: ["confirm_password"],
    message: "passwordMismatch",
  });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "required"),
    new_password: newPassword,
    confirm_password: z.string().min(1, "required"),
  })
  .refine((values) => values.new_password === values.confirm_password, {
    path: ["confirm_password"],
    message: "passwordMismatch",
  });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export const authSessionSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  last_seen_at: z.string().nullable(),
  expires_at: z.string(),
  user_agent: z.string().nullable(),
  ip_address: z.string().nullable(),
  is_current: z.boolean(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

/** Only same-site relative paths are accepted as a post-login destination. */
export function safeNextPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}
