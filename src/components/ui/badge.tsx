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
        // #989 — mirrors status-colors.ts's `info`/`primary` ColorIntent pills
        // (`intentStyles.info.pill` / `.primary.pill`) so a quote's SENT/ACCEPTED
        // state renders in the SAME solid-red-is-live vocabulary DESIGN.md defines,
        // instead of borrowing the unrelated ok/warn/overbooked set.
        info: "text-blue bg-blue-soft", // sent / in-progress-but-not-live
        primary: "text-white bg-red", // live/active/in-use — DESIGN.md's solid red
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
