"use client";

import { useTranslations } from "next-intl";
import { ConnectedAccounts } from "@/modules/accounts";
import { SettingsPage } from "@/modules/settings";

export default function AccountsSettingsPage() {
  const t = useTranslations("accounts");
  return (
    <SettingsPage title={t("title")} description={t("description")}>
      <ConnectedAccounts />
    </SettingsPage>
  );
}
