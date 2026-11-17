"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { errorKey } from "@/infrastructure/api-client";
import { Link, useRouter } from "@/infrastructure/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { Field } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { useForgotPassword, useResetPassword } from "../api";
import { emailOnlySchema, resetPasswordSchema, type EmailOnlyValues, type ResetPasswordValues } from "../schemas";
import { AuthHeading, FormAlert } from "./auth-shell";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("validation");
  const te = useTranslations("errors");
  const forgot = useForgotPassword();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmailOnlyValues>({ resolver: zodResolver(emailOnlySchema), defaultValues: { email: "" } });

  return (
    <>
      <AuthHeading title={t("forgot.title")} description={t("forgot.description")} />
      <form onSubmit={handleSubmit((values) => forgot.mutate(values.email))} noValidate className="flex flex-col gap-4">
        {/* Same message whether or not the address exists, to avoid account enumeration. */}
        {forgot.isSuccess ? <FormAlert tone="success">{t("forgot.sent")}</FormAlert> : null}
        {forgot.error ? <FormAlert>{te(errorKey(forgot.error))}</FormAlert> : null}
        <Field label={t("fields.email")} htmlFor="forgot-email" error={errors.email?.message ? tv(errors.email.message) : undefined}>
          <Input
            id="forgot-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={forgot.isPending} className="w-full">
          {t("forgot.submit")}
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/login">{t("backToLogin")}</Link>
        </Button>
      </form>
    </>
  );
}

export function ResetPasswordForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("validation");
  const te = useTranslations("errors");
  const router = useRouter();
  const token = useSearchParams().get("token");
  const reset = useResetPassword();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { new_password: "", confirm_password: "" },
  });

  if (!token) {
    return (
      <>
        <AuthHeading title={t("reset.invalidTitle")} description={t("reset.invalidDescription")} />
        <Button asChild variant="primary" size="lg" className="w-full">
          <Link href="/forgot-password">{t("reset.requestNew")}</Link>
        </Button>
      </>
    );
  }

  const onSubmit = handleSubmit((values) =>
    reset.mutate({ token, new_password: values.new_password }, { onSuccess: () => router.replace("/login?reset=1") }),
  );

  return (
    <>
      <AuthHeading title={t("reset.title")} description={t("reset.description")} />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {reset.error ? (
          <FormAlert>
            {te(errorKey(reset.error))}{" "}
            <Link href="/forgot-password" className="font-medium underline underline-offset-2">
              {t("reset.requestNew")}
            </Link>
          </FormAlert>
        ) : null}
        <Field
          label={t("fields.newPassword")}
          htmlFor="reset-password"
          hint={t("passwordHint")}
          error={errors.new_password?.message ? tv(errors.new_password.message) : undefined}
        >
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.new_password)}
            {...register("new_password")}
          />
        </Field>
        <Field
          label={t("fields.confirmPassword")}
          htmlFor="reset-confirm"
          error={errors.confirm_password?.message ? tv(errors.confirm_password.message) : undefined}
        >
          <Input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirm_password)}
            {...register("confirm_password")}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={reset.isPending} className="w-full">
          {t("reset.submit")}
        </Button>
      </form>
    </>
  );
}
