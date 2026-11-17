"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/components/ui/button";
import { DialogOverlay } from "@/shared/components/ui/dialog";

/**
 * Centred dialog from `md`, bottom sheet on phones. Pure CSS switch, so the
 * same markup works at every width without viewport sniffing.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            "fixed z-50 flex max-h-[90dvh] flex-col bg-surface-raised shadow-lg outline-none",
            "inset-x-0 bottom-0 rounded-t-xl border-t border-border pb-safe data-[state=open]:animate-sheet-up",
            "md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[min(28rem,calc(100vw-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:pb-0 md:data-[state=open]:animate-pop-in",
            className,
          )}
        >
          <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong md:hidden" />
          <div className="flex items-start gap-3 px-5 pt-4 md:pt-5">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-lg font-semibold break-words text-foreground">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1.5 text-sm break-words text-foreground-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label={closeLabel} className="-mt-1 -mr-2">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {children ? (
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          ) : (
            <div className="h-4" />
          )}
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 md:flex-row md:justify-end">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
