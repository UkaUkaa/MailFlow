"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { errorKey } from "@/infrastructure/api-client";
import { useCurrentUser } from "@/infrastructure/authentication";
import { Button } from "@/shared/components/ui/button";
import { Field } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { useUpdateProfile } from "../api";
import { SettingsCard, SettingsPage } from "./settings-section";

export function ProfileSettings() {
  const t = useTranslations("settings.profile");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const te = useTranslations("errors");
  const user = useCurrentUser();
  const update = useUpdateProfile();
  const [name, setName] = useState(user.display_name);
  const trimmed = name.trim();
  const invalid = trimmed.length === 0 ? "required" : trimmed.length > 80 ? "nameTooLong" : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (invalid) return;
    update.mutate(
      { display_name: trimmed },
      { onSuccess: () => toast.success(t("saved")), onError: (error) => toast.error(te(errorKey(error))) },
    );
  };

  return (
    <SettingsPage title={t("title")} description={t("description")}>
      <SettingsCard>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-4">
          <Field label={t("name")} htmlFor="profile-name" error={invalid ? tv(invalid) : undefined}>
            <Input
              id="profile-name"
              value={name}
              autoComplete="name"
              aria-invalid={Boolean(invalid)}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={t("email")} htmlFor="profile-email" hint={t("emailHint")}>
            <Input id="profile-email" value={user.email} readOnly className="text-foreground-muted" />
          </Field>
          <div>
            <Button
              type="submit"
              variant="primary"
              className="max-sm:w-full"
              loading={update.isPending}
              disabled={Boolean(invalid) || trimmed === user.display_name}
            >
              {tc("save")}
            </Button>
          </div>
        </form>
      </SettingsCard>
    </SettingsPage>
  );
}
