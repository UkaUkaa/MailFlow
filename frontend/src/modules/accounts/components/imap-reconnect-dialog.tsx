"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { Button } from "@/shared/components/ui/button";
import { Field } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { updateImapCredentials, useAccountConnected } from "../api";
import { describeImapError, imapCredentialsSchema, type ImapCredentialsValues, type ImapErrorMessage } from "../lib/imap";
import type { Account } from "../types";

/** Asks for the new password of an IMAP mailbox. OAuth mailboxes reconnect through the provider instead. */
export function ImapReconnectDialog({
  account,
  open,
  onOpenChange,
}: {
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("accounts.imap");
  const tv = useTranslations("validation");
  const tc = useTranslations("common");
  const onConnected = useAccountConnected();
  const [failure, setFailure] = useState<ImapErrorMessage | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ImapCredentialsValues>({ resolver: zodResolver(imapCredentialsSchema), defaultValues: { password: "" } });

  const close = () => {
    reset({ password: "" });
    setFailure(null);
    onOpenChange(false);
  };

  const onSubmit = handleSubmit(async ({ password }) => {
    setFailure(null);
    try {
      onConnected(await updateImapCredentials(account.id, password));
      toast.success(t("reconnected"));
      close();
    } catch (error) {
      setFailure(describeImapError(error));
    }
  });

  const passwordError = errors.password?.message;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("reconnectTitle")}
      description={t("reconnectDescription", { email: account.email_address })}
      closeLabel={tc("close")}
    >
      <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col gap-4">
        {failure ? (
          <div role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-[13px] break-words text-danger">
            {t(`errors.${failure.key}`, failure.values)}
          </div>
        ) : null}
        <Field
          label={t("password")}
          htmlFor="imap-reconnect-password"
          error={passwordError ? tv(passwordError) : undefined}
          hint={t("reconnectHint")}
        >
          <Input
            id="imap-reconnect-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(passwordError)}
            aria-describedby={passwordError ? "imap-reconnect-password-error" : undefined}
            {...register("password")}
          />
        </Field>
        <div className="flex min-w-0 flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button onClick={close}>{tc("cancel")}</Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            {t("reconnectSubmit")}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
