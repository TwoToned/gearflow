import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * RVLT Flow button — pill, tactile press (lifts 1px on hover, drops 2px on active),
 * red = the one primary. See DESIGN.md §9 / §15.2.
 */
const buttonVariants = cva(
  // states (§9.1): focus-visible ring on every variant; tactile press; disabled = greyed,
  // not-allowed cursor, no lift/shadow (clicks blocked by the `disabled` attr).
  "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-sans font-semibold text-[14px] transition-[transform,box-shadow,background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:translate-y-0 disabled:hover:translate-y-0 [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // primary action — the one red
        primary:
          "bg-primary text-primary-foreground shadow-[0_3px_0_var(--red-700)] hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_var(--red-700)]",
        // hero CTA only — primary + sanctioned red bloom (§8); bloom is the --sh-halo token
        halo: "bg-primary text-primary-foreground shadow-[var(--sh-halo)] hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_var(--red-700)]",
        // outline — 2px outline (--line-2 dark / --ink light, §9); fills ink on hover
        line: "border-2 border-border bg-transparent text-ink hover:bg-ink hover:text-paper active:translate-y-px",
        // text only — hover to red
        ghost: "bg-transparent text-ink hover:text-red-text active:opacity-80",
        // cream — for use on the full-red CTA block (fixed cream tokens, §3.6)
        cream:
          "bg-[var(--cream)] text-[var(--cream-ink)] shadow-[var(--sh-cream)] hover:-translate-y-px active:translate-y-[2px] active:shadow-[var(--sh-cream-press)]",
      },
      size: {
        // Touch targets stay 44px; compact 36px height requires a fine pointer.
        // The coarse minimum also protects caller-supplied compact heights.
        sm: "h-11 px-4 [@media(pointer:fine)]:h-9",
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
    if (asChild) {
      // Slot runs child handlers first: replace both capture and bubble handlers
      // on the actual child before Slot composes them. Remove native navigation.
      const inactive = Boolean(disabled || loading);
      const block = (event: React.SyntheticEvent) => {
        event.preventDefault();
        event.stopPropagation();
      };
      const guarded: Record<string, unknown> = inactive ? {
        tabIndex: -1, "aria-disabled": true, "aria-busy": loading || undefined,
        ...(React.isValidElement(children) && children.type === "a" ? { role: (children.props as Record<string, unknown>).role ?? "link" } : {}),
        href: React.isValidElement(children) && typeof children.type !== "string" ? "#" : undefined, disabled: true,
      } : {};
      if (inactive) {
        for (const name of ["onClick", "onAuxClick", "onDoubleClick", "onKeyDown", "onKeyUp", "onMouseDown", "onMouseUp", "onPointerDown", "onPointerUp", "onTouchStart", "onTouchEnd"]) {
          guarded[name] = block;
          guarded[`${name}Capture`] = block;
        }
      }
      const child = inactive && React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, guarded)
        : children;
      return (
        <Slot {...props} className={cn(classes, inactive && "cursor-not-allowed opacity-45", loading && "text-transparent")} ref={ref} {...guarded}>
          {loading && <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0 grid place-items-center", variant === "cream" ? "text-[var(--cream-ink)]" : variant === "line" || variant === "ghost" ? "text-ink" : "text-primary-foreground")}><span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /></span>}
          <Slottable>{child}</Slottable>
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
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
          </span>
        )}
        <span className={cn("inline-flex items-center gap-2", loading && "opacity-0")}>
          {children}
        </span>
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
