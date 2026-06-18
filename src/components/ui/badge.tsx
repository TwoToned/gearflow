import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * RVLT Flow status badge — labelled soft-fill pill. Status is encoded by colour
 * AND a text label, never colour-only (DESIGN.md §3.3). Always render the label.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full font-sans font-bold text-[11px] leading-none px-2.5 py-1",
  {
    variants: {
      status: {
        ok: "text-ok bg-ok-soft", // available / ready / pass
        warn: "text-warn bg-warn-soft", // check / due / warning
        overbooked: "text-t-out bg-out-soft", // overbooked / short / error
        repair: "text-rep bg-rep-soft", // in repair / neutral
        neutral: "text-ink-2 bg-paper-2",
      },
    },
    defaultVariants: { status: "neutral" },
  },
);

function Badge({
  className,
  status,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ status, className }))} {...props} />;
}

export { Badge, badgeVariants };
