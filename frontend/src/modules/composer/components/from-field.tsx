"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, type ChangeEvent } from "react";
import { AccountDot, accountAvatarUrl, type Account } from "@/modules/accounts";
import { cn } from "@/shared/lib/cn";

/**
 * The mailbox the email is sent from, always on screen: its mark, name and full address. With
 * several mailboxes the whole chip is a native select (the platform picker on phones); with one
 * it is plain text, so there is never a doubt where the email goes out from.
 */
export function FromField({
  accounts,
  accountId,
  onChange,
  className,
}: {
  accounts: Account[];
  accountId: string | null;
  onChange: (accountId: string | null) => void;
  className?: string;
}) {
  const t = useTranslations("composer");
  const id = useId();
  const current = accounts.find((account) => account.id === accountId) ?? null;
  const choosable = accounts.length > 1 || !current;
  const name = current?.display_name?.trim() || null;

  const chip = (
    <span className="flex min-w-0 items-center gap-2">
      {current ? (
        <AccountDot color={current.color} imageUrl={accountAvatarUrl(current)} className="size-2.5" imageClassName="size-5" />
      ) : null}
      <span className="min-w-0 truncate text-sm">
        {current ? (
          <>
            {name ? <span className="font-medium text-foreground">{name} </span> : null}
            <span className={name ? "text-foreground-muted" : "font-medium text-foreground"}>
              {name ? `<${current.email_address}>` : current.email_address}
            </span>
          </>
        ) : (
          <span className="text-foreground-muted">{t("chooseAccount")}</span>
        )}
      </span>
    </span>
  );

  return (
    <div className={cn("flex min-w-0 items-center gap-2 py-0.5", className)}>
      {choosable ? (
        <label htmlFor={id} className="flex h-8 w-11 shrink-0 items-center text-sm text-foreground-subtle touch:h-10">
          {t("from")}
        </label>
      ) : (
        <span className="flex h-8 w-11 shrink-0 items-center text-sm text-foreground-subtle touch:h-10">{t("from")}</span>
      )}
      {choosable ? (
        <div className="relative flex h-8 max-w-full min-w-0 items-center gap-1 rounded-sm bg-muted pr-1.5 pl-2 focus-within:ring-2 focus-within:ring-accent hover:bg-muted/70 touch:h-10">
          {chip}
          <ChevronDown className="size-4 shrink-0 text-foreground-subtle" aria-hidden />
          <select
            id={id}
            value={accountId ?? ""}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value || null)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          >
            {!current ? <option value="">{t("chooseAccount")}</option> : null}
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.display_name?.trim() ? `${account.display_name.trim()} <${account.email_address}>` : account.email_address}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="flex h-8 min-w-0 items-center touch:h-10">
          {chip}
        </div>
      )}
    </div>
  );
}
