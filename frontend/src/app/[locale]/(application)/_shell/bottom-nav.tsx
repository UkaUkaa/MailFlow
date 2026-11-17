"use client";

import { Inbox, PenLine, Search, Settings, Star, type LucideIcon } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useComposer } from "@/modules/composer";
import { Link, usePathname } from "@/infrastructure/i18n/navigation";

const itemClasses =
  "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium text-foreground-muted aria-[current=page]:text-accent";

function Item({ href, label, icon: Icon, active }: { href: string; label: string; icon: LucideIcon; active: boolean }) {
  return (
    <li className="flex min-w-0 flex-1">
      <Link href={href} aria-current={active ? "page" : undefined} className={itemClasses}>
        <Icon className="size-5 shrink-0" aria-hidden />
        <span className="max-w-full truncate">{label}</span>
      </Link>
    </li>
  );
}

/** Phone-only primary navigation. Hidden while a conversation is open (the reader has its own action bar). */
export function BottomNav() {
  const t = useTranslations("nav");
  const params = useParams<{ view?: string; threadId?: string }>();
  const pathname = usePathname();
  const account = useSearchParams().get("account");
  const composer = useComposer();
  if (params.threadId) return null;

  const suffix = account ? `?account=${encodeURIComponent(account)}` : "";
  return (
    <nav aria-label={t("primary")} className="shrink-0 border-t border-border bg-surface-raised px-safe pb-safe md:hidden">
      <ul className="flex items-stretch">
        <Item href={`/mail/inbox${suffix}`} label={t("short.inbox")} icon={Inbox} active={params.view === "inbox"} />
        <Item href={`/mail/starred${suffix}`} label={t("short.starred")} icon={Star} active={params.view === "starred"} />
        <li className="flex min-w-0 flex-1 items-center justify-center">
          <button
            type="button"
            onClick={composer.compose}
            aria-label={t("compose")}
            className="inline-flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground active:bg-accent-hover"
          >
            <PenLine className="size-5" aria-hidden />
          </button>
        </li>
        <Item href={`/mail/search${suffix}`} label={t("short.search")} icon={Search} active={params.view === "search"} />
        <Item href="/settings" label={t("short.settings")} icon={Settings} active={pathname.startsWith("/settings")} />
      </ul>
    </nav>
  );
}
