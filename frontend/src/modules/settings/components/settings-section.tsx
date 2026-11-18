import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/** One settings section: a title (the dialog's heading on tablet and wider) and its content. */
export function SettingsPage({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-5 px-4 py-6 md:max-w-none md:px-10 md:pt-10 md:pb-8">
      <div className="hidden min-w-0 flex-col gap-1 pr-8 md:flex">
        <h1 className="text-[15px] leading-5 font-semibold break-words text-foreground">{title}</h1>
        {description ? <p className="text-xs break-words text-foreground-muted">{description}</p> : null}
      </div>
      {description ? <p className="text-sm break-words text-foreground-muted md:hidden">{description}</p> : null}
      {children}
    </div>
  );
}

/**
 * Group of settings. A card by default (forms, lists); `flat` drops the card from tablet up so
 * that plain rows are separated by dividers only.
 */
export function SettingsCard({ children, className, flat = false }: { children: ReactNode; className?: string; flat?: boolean }) {
  return (
    <section
      className={cn(
        "group/card min-w-0 rounded-lg border border-border bg-surface-raised",
        flat && "md:rounded-none md:border-x-0 md:border-b-0 md:bg-transparent",
        className,
      )}
      data-flat={flat || undefined}
    >
      {children}
    </section>
  );
}

/**
 * Icon, title and description on the left, control on the right. On narrow screens the control
 * moves under the text, unless `inline` (small controls such as a switch) keeps it beside it.
 */
export function SettingsRow({
  title,
  titleId,
  description,
  icon: Icon,
  children,
  stacked = false,
  inline = false,
}: {
  title: string;
  titleId?: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
  stacked?: boolean;
  inline?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 gap-3 border-b border-border p-4 last:border-b-0 group-data-[flat]/card:md:px-0 group-data-[flat]/card:md:py-6",
        stacked ? "flex-col" : inline ? "items-center justify-between" : "flex-col sm:flex-row sm:items-center sm:justify-between",
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        {Icon ? <Icon className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /> : null}
        <div className="min-w-0 flex-1">
          <p id={titleId} className="text-sm font-semibold break-words text-foreground">
            {title}
          </p>
          {description ? <p className="mt-1 max-w-[20rem] text-xs break-words text-foreground-muted">{description}</p> : null}
        </div>
      </div>
      <div className={cn("min-w-0", !stacked && "sm:shrink-0", inline && "shrink-0")}>{children}</div>
    </div>
  );
}
