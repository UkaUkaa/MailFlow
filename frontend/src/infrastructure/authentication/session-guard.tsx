"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { setUnauthenticatedHandler } from "@/infrastructure/api-client";
import { usePathname, useRouter } from "@/infrastructure/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { ErrorState } from "@/shared/components/feedback/states";
import { Spinner } from "@/shared/components/feedback/spinner";
import { replaceSession, sessionQueryKey, useSession, type User } from "./session";
import { SessionContext } from "./session-context";

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh items-center justify-center bg-background">{children}</div>;
}

/** Wraps the authenticated area: resolves the session, redirects when absent or expired. */
export function SessionGuard({ children }: { children: ReactNode }) {
  const t = useTranslations("common");
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const queryClient = useQueryClient();

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      queryClient.setQueryData<User | null>(sessionQueryKey, null);
    });
    return () => setUnauthenticatedHandler(null);
  }, [queryClient]);

  const signedOut = session.isSuccess && session.data === null;

  useEffect(() => {
    if (!signedOut) return;
    // Drop every cached tenant resource before leaving the authenticated area.
    replaceSession(queryClient, null);
    const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`/login${next}`, { locale });
  }, [signedOut, pathname, router, locale, queryClient]);

  if (session.isError) {
    return (
      <FullScreen>
        <ErrorState
          title={t("loadFailedTitle")}
          description={t("loadFailedDescription")}
          action={<Button onClick={() => void session.refetch()}>{t("retry")}</Button>}
        />
      </FullScreen>
    );
  }
  if (!session.data) {
    return (
      <FullScreen>
        <Spinner label={t("loading")} />
      </FullScreen>
    );
  }
  return <SessionContext value={session.data}>{children}</SessionContext>;
}
