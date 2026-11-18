import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalDocument } from "@/modules/legal";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.terms" });
  // Public and meant to be found (Google reviews these pages for OAuth verification).
  return { title: t("title"), robots: { index: true, follow: true } };
}

export default function TermsPage() {
  return <LegalDocument document="terms" />;
}
