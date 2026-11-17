import { cn } from "@/shared/lib/cn";
import { DEFAULT_ACCOUNT_COLOR } from "@/shared/constants/account-colors";

export function AccountDot({ color, className }: { color: string | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color || DEFAULT_ACCOUNT_COLOR }}
    />
  );
}
