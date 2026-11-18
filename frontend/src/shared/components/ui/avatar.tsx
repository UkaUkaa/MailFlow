import { avatarColor } from "@/shared/constants/account-colors";
import { cn } from "@/shared/lib/cn";
import { initials } from "@/shared/utils/format";

/**
 * Initials on a disc. With `colorKey` (an address) the disc takes a deterministic hue from the
 * avatar palette; without it the disc is neutral. No picture is ever fetched.
 */
export function Avatar({ name, colorKey, className }: { name: string; colorKey?: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={colorKey ? { backgroundColor: avatarColor(colorKey) } : undefined}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold select-none",
        colorKey ? "text-white" : "bg-muted text-foreground-muted",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
