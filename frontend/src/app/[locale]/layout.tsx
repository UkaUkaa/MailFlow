import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { routing } from "@/infrastructure/i18n/routing";
import { themeInitScript } from "@/infrastructure/theme";
import { navInitScript } from "@/shared/components/layout/nav-state";
import { Providers } from "./providers";
import "../globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter", display: "swap" });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale, namespace: "meta" });
  return {
    title: { default: "MailFlow", template: "%s · MailFlow" },
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#202227" },
  ],
};

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <body>
        {/*
          Applies the stored theme and navigation width before first paint. It must be the first node of <body>, not a
          child of <head>: React and Next manage <head> themselves (hoisted metadata, stylesheets,
          preloads), and an extra element there fails hydration whenever the HTML arrives in one
          piece, e.g. behind a buffering reverse proxy.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} suppressHydrationWarning />
        {/* A second tag, not a concatenation: `themeInitScript` comes from a client module and must be passed through as it is. */}
        <script dangerouslySetInnerHTML={{ __html: navInitScript }} suppressHydrationWarning />
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
