"use client";

import { MailPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/infrastructure/i18n/navigation";
import { EmptyState } from "@/shared/components/feedback/states";
import { Button } from "@/shared/components/ui/button";

/** First-run state for the mail area when no mailbox is connected yet. */
export function ConnectAccountPrompt() {
  const t = useTranslations("accounts");
  return (
    <EmptyState
      icon={MailPlus}
      title={t("emptyTitle")}
      description={t("emptyDescription")}
      action={
        <Button asChild variant="primary">
          <Link href="/settings/accounts">{t("connectAccount")}</Link>
        </Button>
      }
    />
  );
}
