"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { errorKey, isApiError } from "@/infrastructure/api-client";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldError } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { useDeactivateAccount, useDeleteAccount } from "../api";
import { SettingsCard, SettingsPage, SettingsRow } from "./settings-section";

const CONFIRMATION_WORD = "DELETE";

function ConfirmDialog({ kind, onClose }: { kind: "deactivate" | "delete"; onClose: () => void }) {
  const t = useTranslations("settings.danger");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const deactivate = useDeactivateAccount();
  const remove = useDeleteAccount();
  const mutation = kind === "delete" ? remove : deactivate;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const ready = password.length > 0 && (kind === "deactivate" || confirmation === CONFIRMATION_WORD);
  const wrongPassword = isApiError(mutation.error) && (mutation.error.code === "invalid_credentials" || mutation.error.status === 401);

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
          <Button variant="danger" disabled={!ready} loading={mutation.isPending} onClick={() => mutation.mutate(password)}>
            {t(`${kind}.confirmAction`)}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) mutation.mutate(password);
        }}
      >
        <Field label={t("password")} htmlFor="danger-password" error={wrongPassword ? t("wrongPassword") : undefined}>
          <Input
            id="danger-password"
            type="password"
            autoComplete="current-password"
            value={password}
            aria-invalid={wrongPassword}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
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
        {mutation.error && !wrongPassword ? <FieldError>{te(errorKey(mutation.error))}</FieldError> : null}
        <button type="submit" hidden />
      </form>
    </ResponsiveDialog>
  );
}

export function DangerZone() {
  const t = useTranslations("settings.danger");
  const [dialog, setDialog] = useState<"deactivate" | "delete" | null>(null);
  return (
    <SettingsPage title={t("title")} description={t("description")}>
      <SettingsCard className="border-danger/40">
        <SettingsRow title={t("deactivate.title")} description={t("deactivate.description")}>
          <Button variant="secondary" className="max-sm:w-full" onClick={() => setDialog("deactivate")}>
            {t("deactivate.action")}
          </Button>
        </SettingsRow>
        <SettingsRow title={t("delete.title")} description={t("delete.description")}>
          <Button variant="danger" className="max-sm:w-full" onClick={() => setDialog("delete")}>
            {t("delete.action")}
          </Button>
        </SettingsRow>
      </SettingsCard>
      {dialog ? <ConfirmDialog kind={dialog} onClose={() => setDialog(null)} /> : null}
    </SettingsPage>
  );
}
