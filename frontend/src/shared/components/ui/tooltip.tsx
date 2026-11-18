"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useState, type ReactNode } from "react";

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Supplementary only: every tooltip target also carries an accessible name.
 * `shortcut` is shown as a key chip and must only be passed for a shortcut that really works.
 * Opens on mouse hover only, never on focus or touch.
 * `disabled` keeps the tooltip closed without changing the element tree, so the target keeps
 * its focus when the tooltip is switched off (a control whose label has just become visible).
 */
export function Tooltip({
  label,
  shortcut,
  children,
  side = "bottom",
  disabled = false,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // While disabled the Root is held closed, so Radix never reports the matching close; an open
  // recorded then (hover or focus) would otherwise resurface on every tooltip once re-enabled.
  const [wasDisabled, setWasDisabled] = useState(disabled);
  if (wasDisabled !== disabled) {
    setWasDisabled(disabled);
    if (disabled) setOpen(false);
  }
  return (
    <TooltipPrimitive.Root
      open={open && !disabled}
      onOpenChange={(next) => setOpen(next && !disabled)}
    >
      {/* Hover only: Radix also opens on focus, which leaves a tooltip hanging next to a control
          that kept focus after a click (the rail toggle, a nav item). Prevented focus skips it. */}
      <TooltipPrimitive.Trigger asChild onFocus={(event) => event.preventDefault()}>
        {children}
      </TooltipPrimitive.Trigger>
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
