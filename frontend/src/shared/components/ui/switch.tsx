"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/shared/lib/cn";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-border-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50",
        // Enlarged hit area without changing the visual size.
        "after:absolute after:-inset-2.5 after:content-['']",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[1.125rem]" />
    </SwitchPrimitive.Root>
  );
}
