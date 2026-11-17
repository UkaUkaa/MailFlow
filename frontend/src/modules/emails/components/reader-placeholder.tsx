"use client";

import { MailOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/shared/components/feedback/states";

/** Shown in the reading pane while no conversation is open (tablet and wider). */
export function ReaderPlaceholder() {
  const t = useTranslations("reader");
  return <EmptyState icon={MailOpen} title={t("placeholderTitle")} description={t("placeholderDescription")} />;
}
