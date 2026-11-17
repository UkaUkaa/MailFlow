import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export function SettingsPage({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <div className="hidden min-w-0 flex-col gap-1 md:flex">
        <h1 className="text-2xl font-semibold tracking-tight break-words text-foreground">{title}</h1>
        {description ? <p className="text-sm break-words text-foreground-muted">{description}</p> : null}
      </div>
      {description ? <p className="text-sm break-words text-foreground-muted md:hidden">{description}</p> : null}
      {children}
    </div>
  );
}

export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-border bg-surface-raised", className)}>{children}</section>
  );
}

/** Label + description on the left, control on the right; stacks on narrow screens. */
export function SettingsRow({
  title,
  description,
  children,
  stacked = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 gap-3 border-b border-border p-4 last:border-b-0",
        stacked ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words text-foreground">{title}</p>
        {description ? <p className="mt-0.5 text-[13px] break-words text-foreground-muted">{description}</p> : null}
      </div>
      <div className={cn("min-w-0", !stacked && "sm:shrink-0")}>{children}</div>
    </div>
  );
}
