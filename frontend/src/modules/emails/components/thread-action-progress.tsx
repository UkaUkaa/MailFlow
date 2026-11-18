"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutationState } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { THREAD_ACTION_KEY, type ActionVariables } from "../api";

/**
 * Centred, blocking progress while a thread action runs: it names the action and how many
 * conversations it covers, and keeps the rest of the app from being used until the server
 * has answered. A modal dialog that cannot be dismissed traps focus and blocks the pointer.
 * The dim and the card fade in after a short delay, so quick actions do not flash.
 */
export function ThreadActionProgress() {
  const t = useTranslations("mail.actions.progress");
  const pending = useMutationState({
    filters: { mutationKey: THREAD_ACTION_KEY, status: "pending" },
    select: (mutation) => mutation.state.variables as ActionVariables | undefined,
  });
  const current = pending.filter((item): item is ActionVariables => Boolean(item && !item.silent)).at(-1);
  if (!current) return null;
  const label = t(current.action, { count: current.threadIds.length });

  return (
    <DialogPrimitive.Root open modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] animate-fade-in bg-overlay [animation-delay:200ms] [animation-fill-mode:both]" />
        <DialogPrimitive.Content
          aria-busy="true"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="fixed top-1/2 left-1/2 z-[70] flex w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-xl border border-border bg-surface-raised px-6 py-5 text-center shadow-lg outline-none animate-fade-in [animation-delay:200ms] [animation-fill-mode:both]"
        >
          <Loader2 className="size-8 animate-spin text-accent" aria-hidden />
          <DialogPrimitive.Title className="text-sm font-medium text-foreground" aria-live="polite">
            {label}
          </DialogPrimitive.Title>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
