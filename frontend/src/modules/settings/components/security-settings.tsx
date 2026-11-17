"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { changePasswordSchema, useChangePassword, type ChangePasswordValues } from "@/modules/authentication";
import { errorKey, isApiError } from "@/infrastructure/api-client";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldError } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { SettingsCard, SettingsPage } from "./settings-section";

export function SecuritySettings() {
  const t = useTranslations("settings.security");
  const ta = useTranslations("auth");
  const tv = useTranslations("validation");
  const te = useTranslations("errors");
  const change = useChangePassword();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  const onSubmit = handleSubmit((values) =>
    change.mutate(
      { current_password: values.current_password, new_password: values.new_password },
      {
        onSuccess: () => {
          reset();
          toast.success(t("changed"));
        },
      },
    ),
  );
  const message = (key: string | undefined) => (key ? tv(key) : undefined);
  const wrongPassword = isApiError(change.error) && (change.error.code === "invalid_credentials" || change.error.status === 401);

  return (
    <SettingsPage title={t("title")} description={t("description")}>
      <SettingsCard>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 p-4">
          <Field
            label={t("currentPassword")}
            htmlFor="current-password"
            error={message(errors.current_password?.message) ?? (wrongPassword ? t("wrongPassword") : undefined)}
          >
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.current_password) || wrongPassword}
              {...register("current_password")}
            />
          </Field>
          <Field
            label={ta("fields.newPassword")}
            htmlFor="new-password"
            hint={ta("passwordHint")}
            error={message(errors.new_password?.message)}
          >
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.new_password)}
              {...register("new_password")}
            />
          </Field>
          <Field label={ta("fields.confirmPassword")} htmlFor="confirm-password" error={message(errors.confirm_password?.message)}>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.confirm_password)}
              {...register("confirm_password")}
            />
          </Field>
          {change.error && !wrongPassword ? <FieldError>{te(errorKey(change.error))}</FieldError> : null}
          <div>
            <Button type="submit" variant="primary" className="max-sm:w-full" loading={change.isPending}>
              {t("submit")}
            </Button>
          </div>
        </form>
      </SettingsCard>
    </SettingsPage>
  );
}
