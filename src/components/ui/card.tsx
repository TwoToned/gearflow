import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * RVLT Flow card — 2px outline + hard offset shadow (no soft blur).
 * - `interactive`: clickable cards lift 3px to --sh-hover on hover (§9).
 * - `live`: the one active / real-time card lifts to --elev + the lit top-edge (§4/§9).
 */
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { live?: boolean; interactive?: boolean }
>(({ className, live, interactive, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      // 2px outline = --border (--line-2 dark / --ink light, §7); hard offset shadow, no blur
      "rounded-[var(--radius)] border-2 border-border bg-card text-ink shadow-[var(--sh-card)]",
      interactive &&
        "cursor-pointer transition-[transform,box-shadow] hover:-translate-y-[3px] hover:shadow-[var(--sh-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
      live && "bg-elev shadow-[var(--sh-card),var(--lit)]",
      className,
    )}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "font-display font-bold text-[15px] leading-tight tracking-tight",
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-[13.5px] text-muted", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center p-5 pt-0", className)} {...props} />
));
CardFooter.displayName = "CardFooter";

/**
 * Panel — the lighter-weight surface (1px border-line vs Card's 2px border-border)
 * used for stat tiles and standalone content sections that don't need the full
 * Card/CardHeader/CardContent structure (R-8.7.3).
 */
const panelVariants = cva(
  "rounded-[var(--r)] border border-line bg-card shadow-[var(--sh-card)]",
  {
    variants: {
      padding: {
        default: "p-5",
        responsive: "p-5 sm:p-6",
      },
    },
    defaultVariants: { padding: "default" },
  },
);

const Panel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof panelVariants>
>(({ className, padding, ...props }, ref) => (
  <div ref={ref} className={cn(panelVariants({ padding }), className)} {...props} />
));
Panel.displayName = "Panel";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Panel,
};
