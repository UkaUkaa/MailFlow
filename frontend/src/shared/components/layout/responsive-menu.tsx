"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { useIsPhone } from "@/shared/hooks/use-media-query";
import { SheetContent } from "@/shared/components/ui/dialog";

export interface MenuItem {
  key: string;
  label: string;
  /** Secondary text at the end of the row (e.g. the time a preset stands for). */
  hint?: string;
  icon?: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** Dropdown on tablets and desktops, bottom-sheet action list on phones. */
export function ResponsiveMenu({
  trigger,
  items,
  title,
  align = "end",
  onOpenChange,
}: {
  trigger: ReactNode;
  items: MenuItem[];
  title: string;
  align?: "start" | "end";
  onOpenChange?: (open: boolean) => void;
}) {
  const isPhone = useIsPhone();
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  if (isPhone) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
        <SheetContent side="bottom" aria-describedby={undefined}>
          <DialogPrimitive.Title className="px-5 pt-3 pb-1 text-[13px] font-medium text-foreground-muted">
            {title}
          </DialogPrimitive.Title>
          <ul className="overflow-y-auto px-2 pb-2">
            {items.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-base active:bg-muted disabled:opacity-50",
                    item.destructive ? "text-danger" : "text-foreground",
                  )}
                >
                  {item.icon ? <item.icon className="size-5 shrink-0" aria-hidden /> : null}
                  <span className="min-w-0 flex-1 break-words">{item.label}</span>
                  {item.hint ? <span className="shrink-0 text-sm text-foreground-muted tabular-nums">{item.hint}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </SheetContent>
      </DialogPrimitive.Root>
    );
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          aria-label={title}
          className="z-50 max-w-[min(24rem,calc(100vw-1rem))] min-w-44 rounded-lg border border-border bg-surface-raised p-1 shadow-sm data-[state=open]:animate-pop-in"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.key}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={cn(
                "flex min-h-8 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted touch:min-h-11",
                item.destructive ? "text-danger" : "text-foreground",
              )}
            >
              {item.icon ? <item.icon className="size-4 shrink-0" aria-hidden /> : null}
              <span className={cn("min-w-0 flex-1", item.hint ? "whitespace-nowrap" : "break-words")}>{item.label}</span>
              {item.hint ? <span className="shrink-0 pl-4 text-[13px] text-foreground-muted tabular-nums">{item.hint}</span> : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
