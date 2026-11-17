"use client";

import { Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/infrastructure/i18n/navigation";
import { cn } from "@/shared/lib/cn";

/** Submitting navigates to the search view; the query lives in the URL (`?q=`). */
export function SearchBox({ autoFocus = false, className }: { autoFocus?: boolean; className?: string }) {
  const t = useTranslations("search");
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("q") ?? "";
  const account = searchParams.get("account");
  const [value, setValue] = useState(current);
  const [syncedFrom, setSyncedFrom] = useState(current);
  if (syncedFrom !== current) {
    setSyncedFrom(current);
    setValue(current);
  }

  const go = (query: string) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (account) params.set("account", account);
    const suffix = params.toString();
    router.push(`/mail/search${suffix ? `?${suffix}` : ""}`);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const query = value.trim();
    if (query) go(query);
  };

  return (
    <form role="search" onSubmit={submit} className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-subtle" aria-hidden />
      <input
        type="search"
        name="q"
        value={value}
        autoFocus={autoFocus}
        enterKeyHint="search"
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
        placeholder={t("placeholder")}
        aria-label={t("label")}
        className="h-9 w-full min-w-0 rounded-md border border-transparent bg-muted pr-9 pl-9 text-sm text-foreground placeholder:text-foreground-subtle focus-visible:border-accent focus-visible:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent/30 touch:h-11 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label={t("clear")}
          onClick={() => {
            setValue("");
            if (current) go("");
          }}
          className="absolute top-1/2 right-0 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-foreground-subtle hover:text-foreground touch:size-11"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </form>
  );
}
