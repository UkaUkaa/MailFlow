"use client";

import { MailOpen } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Reading pane while no conversation is open (tablet and wider): one large, low-contrast
 * glyph. It is decoration, so the state is named for screen readers in hidden text.
 */
export function ReaderPlaceholder() {
  const t = useTranslations("reader");
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
      <MailOpen className="size-28 text-border-strong" strokeWidth={1} aria-hidden />
      <p className="sr-only">
        {t("placeholderTitle")}. {t("placeholderDescription")}
      </p>
    </div>
  );
}
