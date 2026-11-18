"use client";

import { History, Info } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/infrastructure/i18n/navigation";
import { PaneScroll } from "@/shared/components/layout/pane";
import { useRecentSearches } from "../lib/recent-searches";
import { searchHref } from "./search-box";

/**
 * Shown in the list pane while there is no query. Only things that really work are offered:
 * this session's recent queries and a description of what the search covers. The server does a
 * plain full-text prefix search, so no `from:` / `has:` style operators are suggested.
 */
export function SearchSuggestions() {
  const t = useTranslations("search");
  const account = useSearchParams().get("account");
  const recent = useRecentSearches();

  return (
    <PaneScroll className="px-3 pb-4">
      {recent.length > 0 ? (
        <section aria-labelledby="search-recent-heading">
          <h2 id="search-recent-heading" className="px-2 pt-3 pb-2 text-[13px] text-foreground-subtle">
            {t("recent")}
          </h2>
          <ul>
            {recent.map((query) => (
              <li key={query}>
                <Link
                  href={searchHref(query, account)}
                  aria-label={t("searchFor", { query })}
                  className="flex h-[42px] min-w-0 items-center gap-3 rounded-sm px-2 text-sm font-medium text-foreground -outline-offset-2 hover:bg-muted touch:h-11"
                >
                  <History className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
                  <span className="min-w-0 truncate">{query}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="search-hint-heading" className="flex min-w-0 gap-3 px-2 pt-4">
        <Info className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0">
          <h2 id="search-hint-heading" className="text-sm font-medium break-words text-foreground">
            {t("hintTitle")}
          </h2>
          <p className="mt-0.5 text-xs break-words text-foreground-muted">{t("hintDescription")}</p>
        </div>
      </section>
    </PaneScroll>
  );
}
