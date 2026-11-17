import type { HTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

/** Flex column that can shrink in both axes and owns its own scroll area. */
export function Pane({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("flex min-h-0 min-w-0 flex-col", className)} {...props} />;
}

export function PaneScroll({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  );
}
