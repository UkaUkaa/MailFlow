import { cn } from "@/shared/lib/cn";
import { initials } from "@/shared/utils/format";

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-semibold text-foreground-muted select-none",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
