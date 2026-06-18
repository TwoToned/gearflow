import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * RVLT stat — a figure in display type with a faint label (DESIGN.md §9). High-contrast
 * jump: the ONE bright stat sits at 38px/--ink, its siblings drop to 24px/--ink-2. Concrete
 * over vague ("0 double-bookings", "99.9% accounted for"), never "boost efficiency".
 */
const Stat = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { figure: React.ReactNode; label: React.ReactNode; bright?: boolean }
>(({ className, figure, label, bright = false, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col gap-1", className)} {...props}>
    <span
      className={cn(
        "font-display font-extrabold leading-none tracking-tight tabular-nums",
        bright ? "text-[38px] text-ink" : "text-[24px] text-ink-2",
      )}
    >
      {figure}
    </span>
    <span className="text-[12px] text-faint">{label}</span>
  </div>
));
Stat.displayName = "Stat";

export { Stat };
