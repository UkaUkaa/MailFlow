import { AlertTriangle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <span className="mb-4 inline-flex size-12 items-center justify-center rounded-xl border border-border bg-surface text-foreground-subtle">
        <Icon className="size-5" aria-hidden />
      </span>
      <h2 className="max-w-sm text-base font-semibold break-words text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm break-words text-foreground-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("flex flex-1 flex-col items-center justify-center px-6 py-12 text-center", className)}
    >
      <span className="mb-4 inline-flex size-12 items-center justify-center rounded-xl bg-danger-soft text-danger">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <h2 className="max-w-sm text-base font-semibold break-words text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm break-words text-foreground-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
