"use client";

import { Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "@/infrastructure/i18n/navigation";
import { cn } from "@/shared/lib/cn";
import { lastMailList, mailListHref } from "@/shared/lib/mail-location";
import { addRecentSearch } from "../lib/recent-searches";

/** Locale-less href of the search view for a query, keeping the mailbox filter. */
export function searchHref(query: string, account: string | null): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (account) params.set("account", account);
  const suffix = params.toString();
  return `/mail/search${suffix ? `?${suffix}` : ""}`;
}

/**
 * Search field of the list pane. Submitting puts the query in the URL (`?q=`), which is what
 * the results are loaded from; Escape leaves search for the list the user came from.
 */
export function SearchBox({ autoFocus = false, className }: { autoFocus?: boolean; className?: string }) {
  const t = useTranslations("search");
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const current = searchParams.get("q") ?? "";
  const account = searchParams.get("account");
  const [value, setValue] = useState(current);
  const [syncedFrom, setSyncedFrom] = useState(current);
  if (syncedFrom !== current) {
    setSyncedFrom(current);
    setValue(current);
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const query = value.trim();
    if (!query) return;
    addRecentSearch(query);
    router.push(searchHref(query, account));
  };

  return (
    <form role="search" onSubmit={submit} className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-subtle" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={value}
        autoFocus={autoFocus}
        enterKeyHint="search"
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            router.push(mailListHref(lastMailList()));
          }
        }}
        placeholder={t("placeholder")}
        aria-label={t("label")}
        className="h-9 w-full min-w-0 rounded-sm border-2 border-transparent bg-muted pr-9 pl-9 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus-visible:border-accent focus-visible:bg-surface-raised touch:h-11 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label={t("clear")}
          onClick={() => {
            setValue("");
            if (current) router.push(searchHref("", account));
            inputRef.current?.focus();
          }}
          className="absolute top-1/2 right-0 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-sm text-foreground-subtle hover:text-foreground touch:size-11"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </form>
  );
}
