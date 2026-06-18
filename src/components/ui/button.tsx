import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * RVLT Flow button — pill, tactile press (lifts 1px on hover, drops 2px on active),
 * red = the one primary. See DESIGN.md §9 / §15.2.
 */
const buttonVariants = cva(
  // states (§9.1): focus-visible ring on every variant; tactile press; disabled = greyed,
  // not-allowed cursor, no lift/shadow (clicks blocked by the `disabled` attr).
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-sans font-semibold text-[14px] transition-[transform,box-shadow,background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:translate-y-0 disabled:hover:translate-y-0 [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // primary action — the one red
        primary:
          "bg-red text-white shadow-[0_3px_0_var(--red-700)] hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_var(--red-700)]",
        // hero CTA only — primary + sanctioned red bloom (§8); bloom is the --sh-halo token
        halo: "bg-red text-white shadow-[var(--sh-halo)] hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_var(--red-700)]",
        // outline — 2px outline (--line-2 dark / --ink light, §9); fills ink on hover
        line: "border-2 border-border bg-transparent text-ink hover:bg-ink hover:text-paper active:translate-y-px",
        // text only — hover to red
        ghost: "bg-transparent text-ink hover:text-red active:opacity-80",
        // cream — for use on the full-red CTA block (fixed cream tokens, §3.6)
        cream:
          "bg-[var(--cream)] text-[var(--cream-ink)] shadow-[var(--sh-cream)] hover:-translate-y-px active:translate-y-[2px] active:shadow-[var(--sh-cream-press)]",
      },
      size: {
        sm: "h-9 px-4",
        default: "h-11 px-5",
        lg: "h-12 px-7 text-[15px]",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Loading state (§9.1) — shows a spinner, keeps width, disables. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size, className }));
    // asChild defers rendering to a single child (Slot) — no spinner injection there.
    if (asChild) {
      return (
        <Slot className={classes} ref={ref} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        className={classes}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {/* loading: spinner replaces the label but the label keeps its width (no layout shift, §9.1) */}
        {loading && (
          <span aria-hidden className="absolute inset-0 grid place-items-center">
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </span>
        )}
        <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
          {children}
        </span>
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
