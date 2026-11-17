"use client";

import { AlertCircle, Plus, Server } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/shared/components/feedback/skeleton";
import { Button } from "@/shared/components/ui/button";
import { useProviders, useStartOAuth } from "../api";
import { OAUTH_PROVIDERS, type OAuthProvider } from "../lib/providers";
import { ImapConnectDialog } from "./imap-connect-dialog";

const COPY = {
  gmail: { connect: "connectGmail", notConfigured: "gmailNotConfigured" },
  outlook: { connect: "connectOutlook", notConfigured: "outlookNotConfigured" },
} as const satisfies Record<OAuthProvider, { connect: string; notConfigured: string }>;

/**
 * Offers every OAuth provider the server reports (an unconfigured one is explained, not hidden)
 * and, when the server supports it, connecting any other mailbox by IMAP/SMTP.
 */
export function ConnectSection() {
  const t = useTranslations("accounts");
  const locale = useLocale();
  const providers = useProviders();
  const start = useStartOAuth();
  const [imapOpen, setImapOpen] = useState(false);

  if (providers.isPending) return <Skeleton className="h-11 w-full sm:w-56" />;
  if (providers.isError) {
    return <p className="text-sm text-danger">{t("providersFailed")}</p>;
  }
  const isAvailable = (kind: OAuthProvider) =>
    providers.data.some((provider) => provider.kind === kind && provider.available);
  const available = OAUTH_PROVIDERS.filter(isAvailable);
  const unavailable = OAUTH_PROVIDERS.filter((kind) => !isAvailable(kind));
  const imapAvailable = providers.data.some((provider) => provider.kind === "imap" && provider.available);

  return (
    <div className="flex flex-col gap-3">
      {available.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {available.map((kind, index) => (
            <Button
              key={kind}
              variant={index === 0 ? "primary" : "secondary"}
              className="max-sm:w-full"
              loading={start.isPending && start.variables?.provider === kind}
              disabled={start.isPending}
              onClick={() => start.mutate({ provider: kind, locale }, { onError: () => toast.error(t("connectFailed")) })}
            >
              <Plus aria-hidden />
              {t(COPY[kind].connect)}
            </Button>
          ))}
        </div>
      ) : null}
      {unavailable.map((kind) => (
        <p key={kind} role="status" className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-[13px] text-foreground">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 break-words">{t(COPY[kind].notConfigured)}</span>
        </p>
      ))}
      {imapAvailable ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            variant={available.length === 0 ? "primary" : "secondary"}
            // The label is long in every language: let it wrap instead of overflowing a narrow phone.
            className="h-auto min-h-9 py-1.5 whitespace-normal max-sm:w-full touch:h-auto touch:min-h-11"
            onClick={() => setImapOpen(true)}
          >
            <Server className="size-4" aria-hidden />
            <span className="min-w-0 break-words">{t("connectImap")}</span>
          </Button>
          <ImapConnectDialog open={imapOpen} onOpenChange={setImapOpen} />
        </div>
      ) : (
        <p className="text-[13px] break-words text-foreground-muted">{t("imapNotAvailable")}</p>
      )}
    </div>
  );
}
