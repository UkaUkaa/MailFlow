"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch, type Control, type FieldErrors, type UseFormRegister, type UseFormSetValue } from "react-hook-form";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { Button } from "@/shared/components/ui/button";
import { Field } from "@/shared/components/ui/field";
import { Input, NativeSelect } from "@/shared/components/ui/input";
import { connectImapAccount, useAccountConnected } from "../api";
import {
  ALLOWED_PORTS,
  HOST_PLACEHOLDERS,
  MAIL_SECURITIES,
  SECURITY_LABELS,
  describeImapError,
  imapConnectDefaults,
  imapConnectSchema,
  portAfterSecurityChange,
  rejectedImapFields,
  toImapConnectPayload,
  type ImapConnectValues,
  type ImapErrorMessage,
  type MailSecurity,
  type MailServerKind,
} from "../lib/imap";

const FORM_ID = "imap-connect-form";

function ServerFields({
  kind,
  legend,
  control,
  register,
  setValue,
  errors,
}: {
  kind: MailServerKind;
  legend: string;
  control: Control<ImapConnectValues>;
  register: UseFormRegister<ImapConnectValues>;
  setValue: UseFormSetValue<ImapConnectValues>;
  errors: FieldErrors<ImapConnectValues>;
}) {
  const t = useTranslations("accounts.imap");
  const tv = useTranslations("validation");
  const port = useWatch({ control, name: `${kind}.port` });
  const security = useWatch({ control, name: `${kind}.security` });
  const hostError = errors[kind]?.host?.message;
  const portError = errors[kind]?.port?.message;
  const id = (name: string) => `imap-connect-${kind}-${name}`;

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-3 text-[13px] font-semibold break-words text-foreground">{legend}</legend>
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_8.5rem]">
        <Field
          label={t("host")}
          htmlFor={id("host")}
          error={hostError ? tv(hostError) : undefined}
          className="col-span-2 sm:col-span-1"
        >
          <Input
            id={id("host")}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={HOST_PLACEHOLDERS[kind]}
            aria-invalid={Boolean(hostError)}
            aria-describedby={hostError ? `${id("host")}-error` : undefined}
            {...register(`${kind}.host`)}
          />
        </Field>
        <Field label={t("port")} htmlFor={id("port")} error={portError ? tv(portError) : undefined}>
          <NativeSelect
            id={id("port")}
            value={String(port)}
            aria-invalid={Boolean(portError)}
            aria-describedby={portError ? `${id("port")}-error` : undefined}
            onChange={(event) =>
              setValue(`${kind}.port`, Number(event.target.value) as never, { shouldDirty: true, shouldValidate: true })
            }
          >
            {ALLOWED_PORTS[kind].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("security")} htmlFor={id("security")}>
          <NativeSelect
            id={id("security")}
            value={security}
            onChange={(event) => {
              const next = event.target.value as MailSecurity;
              setValue(`${kind}.security`, next, { shouldDirty: true });
              setValue(`${kind}.port`, portAfterSecurityChange(kind, security, next, port) as never, { shouldDirty: true });
            }}
          >
            {MAIL_SECURITIES.map((value) => (
              <option key={value} value={value}>
                {SECURITY_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </fieldset>
  );
}

/** Connects a mailbox by IMAP/SMTP server and password. The password only ever lives in this form. */
export function ImapConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("accounts.imap");
  const tv = useTranslations("validation");
  const tc = useTranslations("common");
  const onConnected = useAccountConnected();
  const [failure, setFailure] = useState<ImapErrorMessage | null>(null);
  // The username follows the email address until the user types a different one.
  const [usernameEdited, setUsernameEdited] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ImapConnectValues>({ resolver: zodResolver(imapConnectSchema), defaultValues: imapConnectDefaults() });

  /** Drops everything that was typed, the password included. */
  const clear = () => {
    reset(imapConnectDefaults());
    setUsernameEdited(false);
    setFailure(null);
  };
  const close = () => {
    clear();
    onOpenChange(false);
  };

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      const account = await connectImapAccount(toImapConnectPayload(values));
      onConnected(account);
      toast.success(t("connected"));
      close();
    } catch (error) {
      setFailure(describeImapError(error));
      for (const field of rejectedImapFields(error)) setError(field, { type: "server", message: "serverRejected" });
    }
  });

  const text = (name: "email_address" | "display_name" | "username" | "password") => {
    const message = errors[name]?.message;
    return {
      error: message ? tv(message) : undefined,
      input: {
        id: `imap-connect-${name}`,
        "aria-invalid": Boolean(message),
        "aria-describedby": message ? `imap-connect-${name}-error` : undefined,
      },
    };
  };
  const email = text("email_address");
  const displayName = text("display_name");
  const username = text("username");
  const password = text("password");

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("title")}
      description={t("description")}
      closeLabel={tc("close")}
      className="md:w-[min(34rem,calc(100vw-3rem))]"
    >
      {/* The actions sit inside the scrolling form, so on a short screen (open keyboard) nothing is cut off. */}
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col gap-5">
        {failure ? (
          <div role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-[13px] break-words text-danger">
            {t(`errors.${failure.key}`, failure.values)}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-col gap-4">
          <Field label={t("email")} htmlFor={email.input.id} error={email.error}>
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              {...email.input}
              {...register("email_address", {
                onChange: (event: { target: { value: string } }) => {
                  if (!usernameEdited) setValue("username", event.target.value.trim());
                },
              })}
            />
          </Field>
          <Field label={t("displayName")} htmlFor={displayName.input.id} error={displayName.error}>
            <Input autoComplete="off" maxLength={100} {...displayName.input} {...register("display_name")} />
          </Field>
        </div>

        <ServerFields kind="imap" legend={t("incoming")} control={control} register={register} setValue={setValue} errors={errors} />
        <ServerFields kind="smtp" legend={t("outgoing")} control={control} register={register} setValue={setValue} errors={errors} />

        <div className="flex min-w-0 flex-col gap-4">
          <Field label={t("username")} htmlFor={username.input.id} error={username.error} hint={t("usernameHint")}>
            <Input
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              {...username.input}
              {...register("username", {
                onChange: () => setUsernameEdited(true),
              })}
            />
          </Field>
          <Field label={t("password")} htmlFor={password.input.id} error={password.error}>
            <Input type="password" autoComplete="new-password" {...password.input} {...register("password")} />
          </Field>
          <p className="flex min-w-0 items-start gap-2 rounded-md bg-surface p-3 text-[13px] text-foreground-muted">
            <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{t("appPasswordHint")}</span>
          </p>
        </div>

        <div className="flex min-w-0 flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button onClick={close}>{tc("cancel")}</Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            {t("submit")}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
