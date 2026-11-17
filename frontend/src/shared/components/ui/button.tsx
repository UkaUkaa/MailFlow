import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "@/shared/lib/cn";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
        secondary: "border border-border-strong bg-surface-raised text-foreground hover:bg-muted",
        ghost: "text-foreground-muted hover:bg-muted hover:text-foreground",
        soft: "bg-accent-soft text-accent hover:bg-accent-soft/70",
        danger: "bg-danger text-white hover:bg-danger/90 dark:text-background",
        "danger-ghost": "text-danger hover:bg-danger-soft",
        link: "h-auto! min-h-0! px-0! text-accent underline-offset-4 hover:underline",
      },
      size: {
        md: "h-9 px-3.5 text-sm touch:h-11 touch:px-4 touch:text-[15px]",
        sm: "h-8 px-2.5 text-[13px] touch:h-11 touch:px-3.5 touch:text-sm",
        lg: "h-11 px-5 text-[15px]",
        icon: "size-8 touch:size-11 [&_svg]:size-4 touch:[&_svg]:size-5",
        "icon-lg": "size-11 [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  type,
  ref,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot ref={ref} className={classes} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="invisible inline-flex items-center gap-2">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="size-4 animate-spin" aria-hidden />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
