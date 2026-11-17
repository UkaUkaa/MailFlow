"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Supplementary only: every tooltip target also carries an aria-label.
 * `shortcut` is shown as a key chip and must only be passed for a shortcut that really works.
 */
export function Tooltip({
  label,
  shortcut,
  children,
  side = "bottom",
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[60] flex max-w-60 items-center gap-1.5 rounded-sm bg-foreground px-2 py-1 text-xs text-background data-[state=delayed-open]:animate-fade-in"
        >
          <span className="min-w-0 break-words">{label}</span>
          {shortcut ? (
            <kbd className="shrink-0 rounded-[4px] border border-background/30 px-1 font-sans text-[11px] leading-4">{shortcut}</kbd>
          ) : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
