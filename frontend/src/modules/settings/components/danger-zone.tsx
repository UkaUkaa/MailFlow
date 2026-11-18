"use client";

import { CircleCheck, Trash2, UserRoundX } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { errorKey, isApiError } from "@/infrastructure/api-client";
import { usePathname, useRouter } from "@/infrastructure/i18n/navigation";
import { GoogleGlyph, useReauthMethods, useStartGoogleReauth, type ReauthPurpose } from "@/modules/authentication";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldError } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { useDeactivateAccount, useDeleteAccount } from "../api";
import { SettingsCard, SettingsPage, SettingsRow } from "./settings-section";

const CONFIRMATION_WORD = "DELETE";
const REAUTH_ERRORS = ["reauth_mismatch", "reauth_stale", "access_denied", "account_disabled", "not_configured"] as const;
type ReauthError = (typeof REAUTH_ERRORS)[number] | "provider_error";

function asPurpose(value: string | null): ReauthPurpose | null {
  return value === "delete" || value === "deactivate" ? value : null;
}

function asReauthError(value: string | null): ReauthError | null {
  if (!value) return null;
  return (REAUTH_ERRORS as readonly string[]).includes(value) ? (value as ReauthError) : "provider_error";
}

/** The outcome of a Google re-confirmation, read once from the URL Google sent the user back to. */
interface Returned {
  kind: ReauthPurpose;
  error: ReauthError | null;
}

function ConfirmDialog({ kind, returned, onClose }: { kind: ReauthPurpose; returned: Returned | null; onClose: () => void }) {
  const t = useTranslations("settings.danger");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const locale = useLocale();
  const deactivate = useDeactivateAccount();
  const remove = useDeleteAccount();
  const mutation = kind === "delete" ? remove : deactivate;
  const methods = useReauthMethods();
  const startGoogle = useStartGoogleReauth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  // Confirmed with Google: an HttpOnly cookie now stands in for the password (single use, 5 minutes).
  const [googleConfirmed, setGoogleConfirmed] = useState(returned !== null && returned.error === null);

  const confirmed = googleConfirmed || password.length > 0;
  const ready = confirmed && (kind === "deactivate" || confirmation === CONFIRMATION_WORD);
  const rejected = isApiError(mutation.error) && (mutation.error.code === "invalid_credentials" || mutation.error.status === 401);
  const submit = () => {
    if (!ready) return;
    mutation.mutate(googleConfirmed ? null : password, {
      // A used or expired Google confirmation cannot be retried: ask for a new one.
      onError: () => setGoogleConfirmed(false),
    });
  };
  const usedGoogle = googleConfirmed || (rejected && password.length === 0);
  const passwordError = rejected && !usedGoogle ? t("wrongPassword") : undefined;

  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t(`${kind}.confirmTitle`)}
      description={t(`${kind}.confirmDescription`)}
      closeLabel={tc("close")}
      footer={
        <>
          <Button onClick={onClose}>{tc("cancel")}</Button>
          {/* On success the session guard sees the signed-out state and leaves for the login screen. */}
          <Button variant="danger" disabled={!ready} loading={mutation.isPending} onClick={submit}>
            {t(`${kind}.confirmAction`)}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {googleConfirmed ? (
          <p className="flex items-start gap-2 text-sm text-foreground" role="status">
            <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{t("google.confirmed")}</span>
          </p>
        ) : (
          <>
            {methods.data?.google ? (
              <>
                <p className="text-sm text-foreground-muted">{t("google.hint")}</p>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  loading={startGoogle.isPending}
                  onClick={() => startGoogle.mutate({ purpose: kind, locale })}
                >
                  <GoogleGlyph />
                  <span className="truncate">{t("google.action")}</span>
                </Button>
                <div className="flex items-center gap-3 text-[13px] text-foreground-muted">
                  <span aria-hidden className="h-px flex-1 bg-border" />
                  {t("google.or")}
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </div>
              </>
            ) : null}
            <Field label={t("password")} htmlFor="danger-password" error={passwordError}>
              <Input
                id="danger-password"
                type="password"
                autoComplete="current-password"
                value={password}
                aria-invalid={passwordError !== undefined}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
          </>
        )}
        {kind === "delete" ? (
          <Field label={t("delete.typeToConfirm", { word: CONFIRMATION_WORD })} htmlFor="danger-confirmation">
            <Input
              id="danger-confirmation"
              value={confirmation}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
        ) : null}
        {returned?.error && !mutation.error ? <FieldError>{t(`google.errors.${returned.error}`)}</FieldError> : null}
        {rejected && usedGoogle ? <FieldError>{t("google.expired")}</FieldError> : null}
        {mutation.error && !rejected ? <FieldError>{te(errorKey(mutation.error))}</FieldError> : null}
        {startGoogle.error ? <FieldError>{te(errorKey(startGoogle.error))}</FieldError> : null}
        <button type="submit" hidden />
      </form>
    </ResponsiveDialog>
  );
}

export function DangerZone() {
  const t = useTranslations("settings.danger");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [returned] = useState<Returned | null>(() => {
    const kind = asPurpose(searchParams.get("reauth"));
    return kind ? { kind, error: asReauthError(searchParams.get("reauth_error")) } : null;
  });
  const [dialog, setDialog] = useState<ReauthPurpose | null>(returned?.kind ?? null);

  // Drop the one-time query so a reload or "back" does not reopen the dialog.
  useEffect(() => {
    if (searchParams.has("reauth")) router.replace(pathname);
  }, [searchParams, router, pathname]);

  return (
    <SettingsPage title={t("title")} description={t("description")}>
      <SettingsCard flat className="border-danger/40 md:border-border">
        <SettingsRow icon={UserRoundX} title={t("deactivate.title")} description={t("deactivate.description")}>
          <Button variant="secondary" className="max-sm:w-full" onClick={() => setDialog("deactivate")}>
            {t("deactivate.action")}
          </Button>
        </SettingsRow>
        <SettingsRow icon={Trash2} title={t("delete.title")} description={t("delete.description")}>
          <Button variant="danger" className="max-sm:w-full" onClick={() => setDialog("delete")}>
            {t("delete.action")}
          </Button>
        </SettingsRow>
      </SettingsCard>
      {dialog ? (
        <ConfirmDialog kind={dialog} returned={returned?.kind === dialog ? returned : null} onClose={() => setDialog(null)} />
      ) : null}
    </SettingsPage>
  );
}
