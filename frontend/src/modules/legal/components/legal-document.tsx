"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  GOOGLE_PERMISSIONS_URL,
  GOOGLE_USER_DATA_POLICY_URL,
  LEGAL_CONTACT_EMAIL,
  LEGAL_UPDATED_AT,
} from "../constants";

type Section = { title: string; body: Record<string, string> };

const external = (href: string) =>
  function ExternalLink(chunks: ReactNode) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline-offset-2 hover:underline">
        {chunks}
      </a>
    );
  };

const rich = {
  strong: (chunks: ReactNode) => <strong className="font-semibold text-foreground">{chunks}</strong>,
  policy: external(GOOGLE_USER_DATA_POLICY_URL),
  permissions: external(GOOGLE_PERMISSIONS_URL),
  email: () => (
    <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="font-medium break-all text-accent underline-offset-2 hover:underline">
      {LEGAL_CONTACT_EMAIL}
    </a>
  ),
};

/** Renders a legal document whose sections and paragraphs live in the message catalogs. */
export function LegalDocument({ document }: { document: "privacy" | "terms" }) {
  const t = useTranslations(`legal.${document}`);
  const tl = useTranslations("legal");
  const format = useFormatter();
  const sections = t.raw("sections") as Record<string, Section>;

  return (
    <article className="flex flex-col gap-8 break-words">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{t("title")}</h1>
        <p className="text-sm text-foreground-muted">
          {tl("updated", { date: format.dateTime(new Date(`${LEGAL_UPDATED_AT}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" }) })}
        </p>
        <p className="text-[15px] leading-relaxed text-foreground">{t.rich("intro", rich)}</p>
      </header>
      {Object.entries(sections).map(([key, section], index) => (
        <section key={key} aria-labelledby={`${document}-${key}`} className="flex flex-col gap-3">
          <h2 id={`${document}-${key}`} className="text-lg font-semibold text-foreground">
            {index + 1}. {section.title}
          </h2>
          {Object.keys(section.body).map((paragraph) => (
            <p key={paragraph} className="text-[15px] leading-relaxed text-foreground-muted">
              {t.rich(`sections.${key}.body.${paragraph}`, rich)}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
