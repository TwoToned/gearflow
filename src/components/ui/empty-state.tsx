import * as React from "react";

import { cn } from "@/lib/utils";
import { FlowMascot } from "@/components/ui/flow-mascot";

/**
 * RVLT empty state (DESIGN.md §15.5) — the Flow mascot + one operator-voice line, the
 * sanctioned home for personality in the app. e.g. "Nothing booked yet — Flow's having a
 * quiet one." / "No clashes. Suspiciously calm." Optional action (usually a line button).
 */
const EmptyState = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }
>(({ className, title, description, action, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-col items-center gap-3 rounded-[var(--r-lg)] border-2 border-dashed border-border p-7 text-center",
      className,
    )}
    {...props}
  >
    <FlowMascot className="size-12 text-muted" />
    <div className="flex flex-col gap-1">
      <p className="text-[14px] font-medium text-ink-2">{title}</p>
      {description ? <p className="text-[12.5px] text-faint">{description}</p> : null}
    </div>
    {action}
    {children}
  </div>
));
EmptyState.displayName = "EmptyState";

export { EmptyState };
