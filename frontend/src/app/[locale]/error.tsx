"use client";

import { useTranslations } from "next-intl";
import { ErrorState } from "@/shared/components/feedback/states";
import { Button } from "@/shared/components/ui/button";

export default function LocaleError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("common");
  return (
    <div className="flex min-h-dvh bg-background">
      <ErrorState title={t("unexpectedTitle")} description={t("unexpectedDescription")} action={<Button onClick={reset}>{t("retry")}</Button>} />
    </div>
  );
}
