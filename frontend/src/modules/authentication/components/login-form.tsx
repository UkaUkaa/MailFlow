"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { errorKey, isApiError } from "@/infrastructure/api-client";
import { Link } from "@/infrastructure/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { Field } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { useLogin, useResendVerification } from "../api";
import { loginSchema, type LoginValues } from "../schemas";
import { AuthHeading, FormAlert } from "./auth-shell";

export function LoginForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("validation");
  const te = useTranslations("errors");
  const searchParams = useSearchParams();
  const login = useLogin();
  const resend = useResendVerification();
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = handleSubmit((values) => {
    resend.reset();
    // Navigation happens in RedirectIfAuthenticated once the session is set.
    login.mutate(values);
  });

  const notVerified = isApiError(login.error) && login.error.code === "email_not_verified";

  return (
    <>
      <AuthHeading title={t("login.title")} description={t("login.description")} />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {searchParams.get("reset") === "1" && !login.error ? <FormAlert tone="success">{t("login.passwordResetDone")}</FormAlert> : null}
        {login.error ? (
          <FormAlert>
            {te(errorKey(login.error))}
            {notVerified ? (
              <span className="mt-1 block">
                {resend.isSuccess ? (
                  t("verify.resent")
                ) : (
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2"
                    disabled={resend.isPending}
                    onClick={() => resend.mutate(getValues("email"))}
                  >
                    {t("verify.resend")}
                  </button>
                )}
              </span>
            ) : null}
          </FormAlert>
        ) : null}
        <Field label={t("fields.email")} htmlFor="login-email" error={errors.email?.message ? tv(errors.email.message) : undefined}>
          <Input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "login-email-error" : undefined}
            {...register("email")}
          />
        </Field>
        <Field
          label={t("fields.password")}
          aside={
            <Link href="/forgot-password" className="shrink-0 text-[13px] text-accent hover:underline">
              {t("login.forgot")}
            </Link>
          }
          htmlFor="login-password"
          error={errors.password?.message ? tv(errors.password.message) : undefined}
        >
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "login-password-error" : undefined}
            {...register("password")}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={login.isPending} className="mt-1 w-full">
          {t("login.submit")}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-foreground-muted">
        {t("login.noAccount")}{" "}
        <Link href="/register" className="font-medium text-accent hover:underline">
          {t("login.createAccount")}
        </Link>
      </p>
    </>
  );
}
