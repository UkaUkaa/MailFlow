"use client";

import { useTranslations } from "next-intl";
import { ConnectedAccounts } from "@/modules/accounts";

export default function AccountsSettingsPage() {
  const t = useTranslations("accounts");
  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <div className="hidden min-w-0 flex-col gap-1 md:flex">
        <h1 className="text-2xl font-semibold tracking-tight break-words text-foreground">{t("title")}</h1>
        <p className="text-sm break-words text-foreground-muted">{t("description")}</p>
      </div>
      <p className="text-sm break-words text-foreground-muted md:hidden">{t("description")}</p>
      <ConnectedAccounts />
    </div>
  );
}
