"use client";

import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";
import { accountKeys, useSyncNow, useSyncStatus } from "../api";

/** Manual synchronisation for one mailbox or, with `accountId = null`, for all. */
export function SyncButton({ accountId, className }: { accountId: string | null; className?: string }) {
  const t = useTranslations("sync");
  const queryClient = useQueryClient();
  const status = useSyncStatus();
  const syncNow = useSyncNow();

  const relevant = (status.data ?? []).filter((item) => accountId === null || item.account_id === accountId);
  const active = relevant.some((item) => item.status === "queued" || item.status === "running");
  const busy = active || syncNow.isPending;

  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) {
      // A run just finished: new mail may have arrived.
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
      void queryClient.invalidateQueries({ queryKey: accountKeys.list() });
    }
    wasActive.current = active;
  }, [active, queryClient]);

  const label = busy ? t("syncing") : t("syncNow");
  return (
    <Tooltip label={label}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-disabled={busy}
        className={className}
        onClick={() => {
          if (busy) return;
          syncNow.mutate(accountId, {
            onError: () => toast.error(t("failed")),
          });
        }}
      >
        <RefreshCw className={cn(busy && "animate-spin")} aria-hidden />
      </Button>
    </Tooltip>
  );
}
