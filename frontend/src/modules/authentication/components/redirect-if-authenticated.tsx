"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/infrastructure/authentication";
import { useRouter } from "@/infrastructure/i18n/navigation";
import { safeNextPath } from "../schemas";

/** Signed-in users have no business on the login or registration screens. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const signedIn = Boolean(session.data);
  useEffect(() => {
    // `next` arrives without the locale prefix; the router adds the active one.
    if (signedIn) router.replace(next ?? "/mail/inbox");
  }, [signedIn, router, next]);
  return <>{children}</>;
}
