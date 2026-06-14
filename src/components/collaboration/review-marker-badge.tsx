"use client";

import { cn } from "@/lib/utils";

export type MarkerStatus = "needs_review" | "follow_up" | "resolved";

const markerConfig: Record<MarkerStatus, { label: string; className: string }> = {
  needs_review: {
    label: "Needs review",
    className: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700",
  },
  follow_up: {
    label: "Follow up",
    className: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700",
  },
  resolved: {
    label: "Resolved",
    className: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700",
  },
};

interface ReviewMarkerBadgeProps {
  status: MarkerStatus;
  reason?: string;
  className?: string;
}

/** Small inline badge showing a review/follow-up/resolved marker. */
export function ReviewMarkerBadge({ status, reason, className }: ReviewMarkerBadgeProps) {
  const cfg = markerConfig[status];
  const label = reason ? `${cfg.label}: ${reason}` : cfg.label;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none",
        cfg.className,
        className
      )}
      title={label}
    >
      {label.length > 20 ? cfg.label : label}
    </span>
  );
}
