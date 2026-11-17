import { cn } from "@/shared/lib/cn";

/** MailFlow mark: an envelope flap reduced to two strokes inside a rounded square. */
export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6 shrink-0", className)}>
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <path
        d="M6 8.5l6 4.5 6-4.5M6 15.5h7"
        fill="none"
        stroke="var(--accent-foreground)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <BrandGlyph />
      <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">MailFlow</span>
    </span>
  );
}
