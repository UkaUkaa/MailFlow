"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "./button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogOverlay({ className }: { className?: string }) {
  return (
    <DialogPrimitive.Overlay
      className={cn("fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in", className)}
    />
  );
}

type Side = "left" | "bottom";

/** Edge-anchored panel: navigation drawer (left) or bottom sheet. */
export function SheetContent({
  side,
  className,
  children,
  closeLabel,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "children"> & {
  side: Side;
  children: ReactNode;
  closeLabel?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col bg-surface-raised shadow-lg outline-none",
          side === "left" &&
            "inset-y-0 left-0 w-[min(20rem,calc(100vw-3rem))] border-r border-border pt-safe pb-safe data-[state=open]:animate-drawer-in",
          side === "bottom" &&
            "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t border-border pb-safe data-[state=open]:animate-sheet-up",
          className,
        )}
        {...props}
      >
        {side === "bottom" ? (
          <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong" />
        ) : null}
        {children}
        {closeLabel ? (
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label={closeLabel} className="absolute top-[max(0.375rem,env(safe-area-inset-top))] right-2">
              <X />
            </Button>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
