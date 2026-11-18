"use client";

import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { API_BASE } from "@/infrastructure/api-client";
import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/cn";
import { useSignInProviders } from "../api";
import { safeNextPath } from "../schemas";
import { FormAlert } from "./auth-shell";

const KNOWN_ERRORS = ["access_denied", "email_not_verified", "account_disabled", "invalid_state", "not_configured"] as const;
type SignInError = (typeof KNOWN_ERRORS)[number] | "provider_error";

function signInError(value: string | null): SignInError | null {
  if (!value) return null;
  return (KNOWN_ERRORS as readonly string[]).includes(value) ? (value as SignInError) : "provider_error";
}

export function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-[18px]">
      <path fill="#4285F4" d="M23.5 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.73Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.28a12 12 0 0 0 0 10.8l4.01-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.59 1.8l3.44-3.44A11.53 11.53 0 0 0 12 0 12 12 0 0 0 1.28 6.6l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75Z" />
    </svg>
  );
}

/** "Continue with Google": signs in to MailFlow (or creates the account). Grants no mail access. */
export function GoogleSignIn() {
  const t = useTranslations("auth.google");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const providers = useSignInProviders();
  const error = signInError(searchParams.get("oauth_error"));
  const next = safeNextPath(searchParams.get("next"));

  const params = new URLSearchParams({ locale });
  if (next) params.set("next", next);
  // A plain top-level navigation: the backend redirects to Google and back.
  const href = `${API_BASE}/auth/oauth/google/start?${params.toString()}`;

  if (!error && !providers.data?.google) return null;
  return (
    <div className="mb-4 flex flex-col gap-4">
      {error ? <FormAlert>{t(`errors.${error}`)}</FormAlert> : null}
      {providers.data?.google ? (
        <>
          <a href={href} className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full")}>
            <GoogleGlyph />
            <span className="truncate">{t("continue")}</span>
          </a>
          <div className="flex items-center gap-3 text-[13px] text-foreground-muted">
            <span aria-hidden className="h-px flex-1 bg-border" />
            {t("or")}
            <span aria-hidden className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}
    </div>
  );
}
