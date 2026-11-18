"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/infrastructure/i18n/navigation";

/** Privacy policy and terms, linked from every public screen (required by Google OAuth). */
export function LegalLinks() {
  const t = useTranslations("legal");
  const linkClass = "inline-flex min-h-11 items-center px-2 text-[13px] text-foreground-muted hover:text-foreground hover:underline";
  return (
    <nav aria-label={t("navLabel")} className="flex flex-wrap items-center justify-center gap-x-2">
      <Link href="/privacy" className={linkClass}>
        {t("privacy.title")}
      </Link>
      <span aria-hidden className="text-foreground-muted">·</span>
      <Link href="/terms" className={linkClass}>
        {t("terms.title")}
      </Link>
    </nav>
  );
}
