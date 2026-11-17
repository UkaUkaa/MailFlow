import * as LabelPrimitive from "@radix-ui/react-label";
import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("text-[13px] font-medium text-foreground", className)}
      {...props}
    />
  );
}

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-[13px] text-danger">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  aside,
  children,
  className,
}: {
  label: ReactNode;
  /** Extra control shown beside the label (kept outside the <label> element). */
  aside?: ReactNode;
  htmlFor: string;
  error?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {aside}
      </div>
      {children}
      {hint && !error ? <p className="text-[13px] text-foreground-muted">{hint}</p> : null}
      <FieldError id={`${htmlFor}-error`}>{error}</FieldError>
    </div>
  );
}
