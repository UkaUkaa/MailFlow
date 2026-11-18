"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { errorKey } from "@/infrastructure/api-client";
import { Link } from "@/infrastructure/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { Field } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { useRegister, useResendVerification } from "../api";
import { registerSchema, type RegisterValues } from "../schemas";
import { GoogleSignIn } from "./google-sign-in";
import { AuthHeading, FormAlert } from "./auth-shell";

export function CheckEmailNotice({ email }: { email: string }) {
  const t = useTranslations("auth");
  const te = useTranslations("errors");
  const resend = useResendVerification();
  return (
    <div className="flex flex-col items-center text-center">
      <span className="mb-4 inline-flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <MailCheck className="size-6" aria-hidden />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("register.checkEmailTitle")}</h1>
      <p className="mt-2 max-w-full text-sm break-words text-foreground-muted">
        {t.rich("register.checkEmailDescription", {
          email,
          strong: (chunks) => <strong className="font-medium break-all text-foreground">{chunks}</strong>,
        })}
      </p>
      <div className="mt-6 flex w-full flex-col gap-3">
        {resend.isSuccess ? <FormAlert tone="success">{t("verify.resent")}</FormAlert> : null}
        {resend.error ? <FormAlert>{te(errorKey(resend.error))}</FormAlert> : null}
        <Button className="w-full" loading={resend.isPending} onClick={() => resend.mutate(email)}>
          {t("verify.resend")}
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/login">{t("backToLogin")}</Link>
        </Button>
      </div>
    </div>
  );
}

export function RegisterForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("validation");
  const te = useTranslations("errors");
  const locale = useLocale();
  const registration = useRegister();
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { display_name: "", email: "", password: "", confirm_password: "" },
  });

  if (submittedEmail) return <CheckEmailNotice email={submittedEmail} />;

  const onSubmit = handleSubmit((values) => {
    registration.mutate(
      { email: values.email, password: values.password, display_name: values.display_name, locale },
      { onSuccess: () => setSubmittedEmail(values.email) },
    );
  });
  const message = (key: string | undefined) => (key ? tv(key) : undefined);

  return (
    <>
      <AuthHeading title={t("register.title")} description={t("register.description")} />
      <GoogleSignIn />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {registration.error ? <FormAlert>{te(errorKey(registration.error))}</FormAlert> : null}
        <Field label={t("fields.name")} htmlFor="register-name" error={message(errors.display_name?.message)}>
          <Input id="register-name" autoComplete="name" aria-invalid={Boolean(errors.display_name)} {...register("display_name")} />
        </Field>
        <Field label={t("fields.email")} htmlFor="register-email" error={message(errors.email?.message)}>
          <Input
            id="register-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />
        </Field>
        <Field
          label={t("fields.password")}
          htmlFor="register-password"
          hint={t("passwordHint")}
          error={message(errors.password?.message)}
        >
          <Input
            id="register-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            {...register("password")}
          />
        </Field>
        <Field label={t("fields.confirmPassword")} htmlFor="register-confirm" error={message(errors.confirm_password?.message)}>
          <Input
            id="register-confirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirm_password)}
            {...register("confirm_password")}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={registration.isPending} className="mt-1 w-full">
          {t("register.submit")}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-foreground-muted">
        {t("register.haveAccount")}{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          {t("register.signIn")}
        </Link>
      </p>
    </>
  );
}
