import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

const fieldClasses =
  "w-full min-w-0 rounded-md border border-border-strong bg-surface-raised px-3 text-sm text-foreground placeholder:text-foreground-subtle transition-colors hover:border-foreground-subtle focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger";

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(fieldClasses, "h-9 touch:h-11", className)} {...props} />;
}

export function Textarea({
  className,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} className={cn(fieldClasses, "min-h-24 py-2", className)} {...props} />;
}

export function NativeSelect({
  className,
  ref,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  return (
    <select
      ref={ref}
      className={cn(
        fieldClasses,
        "h-9 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9 touch:h-11",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238a8c98%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
