"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, CircleX } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { errorKey } from "@/infrastructure/api-client";
import { Link } from "@/infrastructure/i18n/navigation";
import { Spinner } from "@/shared/components/feedback/spinner";
import { Button } from "@/shared/components/ui/button";
import { Field } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { useResendVerification, useVerifyEmail } from "../api";
import { emailOnlySchema, type EmailOnlyValues } from "../schemas";
import { FormAlert } from "./auth-shell";

function ResendForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("validation");
  const te = useTranslations("errors");
  const resend = useResendVerification();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmailOnlyValues>({ resolver: zodResolver(emailOnlySchema), defaultValues: { email: "" } });

  return (
    <form onSubmit={handleSubmit((values) => resend.mutate(values.email))} noValidate className="mt-6 flex w-full flex-col gap-3 text-left">
      {resend.isSuccess ? <FormAlert tone="success">{t("verify.resent")}</FormAlert> : null}
      {resend.error ? <FormAlert>{te(errorKey(resend.error))}</FormAlert> : null}
      <Field label={t("fields.email")} htmlFor="verify-email" error={errors.email?.message ? tv(errors.email.message) : undefined}>
        <Input id="verify-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" {...register("email")} />
      </Field>
      <Button type="submit" loading={resend.isPending} className="w-full">
        {t("verify.resend")}
      </Button>
    </form>
  );
}

export function VerifyEmail() {
  const t = useTranslations("auth");
  const token = useSearchParams().get("token");
  const verify = useVerifyEmail();
  const { mutate } = verify;
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    mutate(token);
  }, [token, mutate]);

  const failed = !token || verify.isError;
  return (
    <div className="flex flex-col items-center text-center">
      {verify.isSuccess ? (
        <>
          <CircleCheck className="mb-4 size-12 text-success" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("verify.successTitle")}</h1>
          <p className="mt-2 text-sm break-words text-foreground-muted">{t("verify.successDescription")}</p>
          <Button asChild variant="primary" size="lg" className="mt-6 w-full">
            <Link href="/login">{t("verify.continue")}</Link>
          </Button>
        </>
      ) : failed ? (
        <>
          <CircleX className="mb-4 size-12 text-danger" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("verify.failedTitle")}</h1>
          <p className="mt-2 text-sm break-words text-foreground-muted">{t("verify.failedDescription")}</p>
          <ResendForm />
          <Button asChild variant="ghost" className="mt-2 w-full">
            <Link href="/login">{t("backToLogin")}</Link>
          </Button>
        </>
      ) : (
        <>
          <Spinner className="mb-4 size-8" label={t("verify.pendingTitle")} />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("verify.pendingTitle")}</h1>
        </>
      )}
    </div>
  );
}
