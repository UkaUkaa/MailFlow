"use client";

import { MonitorSmartphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuthSessions, useRevokeOtherSessions, useRevokeSession, type AuthSession } from "@/modules/authentication";
import { Skeleton } from "@/shared/components/feedback/skeleton";
import { ErrorState } from "@/shared/components/feedback/states";
import { Button } from "@/shared/components/ui/button";
import { formatFullDate } from "@/shared/utils/format";
import { SettingsCard, SettingsPage } from "./settings-section";

/** Short, human description of a user-agent string without shipping a parser. */
function describeAgent(userAgent: string | null, unknown: string): string {
  if (!userAgent) return unknown;
  const browser =
    /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : null;
  const system =
    /iPhone|iPad/.test(userAgent) ? "iOS" : /Android/.test(userAgent) ? "Android" : /Mac OS X/.test(userAgent) ? "macOS" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : null;
  return [browser, system].filter(Boolean).join(" · ") || userAgent.slice(0, 60);
}

function SessionRow({ session }: { session: AuthSession }) {
  const t = useTranslations("settings.sessions");
  const tc = useTranslations("common");
  const locale = useLocale();
  const revoke = useRevokeSession();
  return (
    <li className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-muted">
          <MonitorSmartphone className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground">
            <span className="min-w-0 truncate">{describeAgent(session.user_agent, t("unknownDevice"))}</span>
            {session.is_current ? (
              <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">{t("current")}</span>
            ) : null}
          </p>
          <p className="text-[13px] break-words text-foreground-muted">
            {session.ip_address ? `${session.ip_address} · ` : ""}
            {t("lastActive", { date: formatFullDate(session.last_seen_at ?? session.created_at, locale) })}
          </p>
        </div>
      </div>
      {!session.is_current ? (
        <Button
          variant="secondary"
          size="sm"
          loading={revoke.isPending}
          onClick={() =>
            revoke.mutate(session.id, {
              onSuccess: () => toast.success(t("revoked")),
              onError: () => toast.error(tc("genericError")),
            })
          }
        >
          {t("revoke")}
        </Button>
      ) : null}
    </li>
  );
}

export function SessionsSettings() {
  const t = useTranslations("settings.sessions");
  const tc = useTranslations("common");
  const sessions = useAuthSessions();
  const revokeOthers = useRevokeOtherSessions();
  const others = (sessions.data ?? []).filter((session) => !session.is_current).length;

  return (
    <SettingsPage title={t("title")} description={t("description")}>
      {sessions.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-[72px]" />
          <Skeleton className="h-[72px]" />
        </div>
      ) : sessions.isError ? (
        <ErrorState
          className="rounded-lg border border-border py-8"
          title={tc("loadFailedTitle")}
          description={tc("loadFailedDescription")}
          action={<Button onClick={() => void sessions.refetch()}>{tc("retry")}</Button>}
        />
      ) : (
        <>
          <SettingsCard>
            <ul className="divide-y divide-border">
              {sessions.data.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </ul>
          </SettingsCard>
          {others > 0 ? (
            <div>
              <Button
                variant="danger-ghost"
                className="max-sm:w-full"
                loading={revokeOthers.isPending}
                onClick={() =>
                  revokeOthers.mutate(undefined, {
                    onSuccess: () => toast.success(t("othersRevoked")),
                    onError: () => toast.error(tc("genericError")),
                  })
                }
              >
                {t("revokeOthers")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </SettingsPage>
  );
}
