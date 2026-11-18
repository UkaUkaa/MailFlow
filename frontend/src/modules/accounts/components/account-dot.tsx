import { cn } from "@/shared/lib/cn";
import { DEFAULT_ACCOUNT_COLOR } from "@/shared/constants/account-colors";

/**
 * The mailbox's identification mark: its picture when it has one, otherwise a dot in its colour.
 * Decorative: the mailbox is always named in text nearby.
 */
export function AccountDot({
  color,
  imageUrl,
  className,
  imageClassName,
}: {
  color: string | null | undefined;
  imageUrl?: string | null;
  className?: string;
  /** Size of the picture, which needs more room than the dot to be recognisable. */
  imageClassName?: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a tiny same-origin picture behind the session cookie
      <img
        src={imageUrl}
        alt=""
        aria-hidden
        width={16}
        height={16}
        loading="lazy"
        decoding="async"
        draggable={false}
        className={cn("inline-block size-4 shrink-0 rounded-full object-cover", imageClassName)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color || DEFAULT_ACCOUNT_COLOR }}
    />
  );
}
