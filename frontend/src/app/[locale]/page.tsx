import { redirect } from "@/infrastructure/i18n/navigation";

export default async function LocaleIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: "/mail/inbox", locale });
}
