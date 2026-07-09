"use client";

import { cn } from "@/lib/utils";
import { formatPayback } from "@/lib/roi";

/**
 * Progress toward "this gear has paid for itself", and past it.
 *
 * The bar fills to 100% at break-even and stops. Once payback exceeds 1× the bar
 * stays full and turns green — the useful signal past break-even is the multiple,
 * which the label carries, not a bar that would have to rescale every row against
 * the fleet's best performer and make everything else look like a failure.
 */
export function PaybackBar({
  payback,
  className,
  showLabel = true,
}: {
  payback: number | null;
  className?: string;
  showLabel?: boolean;
}) {
  if (payback == null) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <div className="h-2 flex-1 rounded-full bg-paper-2" />
        {showLabel && <span className="w-14 text-right text-caption text-faint">—</span>}
      </div>
    );
  }

  const filled = Math.min(1, Math.max(0, payback));
  const recovered = payback >= 1;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-paper-2"
        role="progressbar"
        aria-valuenow={Math.round(filled * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Cost recovered"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            recovered ? "bg-ok" : filled >= 0.5 ? "bg-warn" : "bg-t-out",
          )}
          style={{ width: `${filled * 100}%` }}
        />
      </div>
      {showLabel && (
        <span
          className={cn(
            "w-14 text-right text-caption tabular-nums",
            recovered ? "text-ok" : "text-muted",
          )}
        >
          {formatPayback(payback)}
        </span>
      )}
    </div>
  );
}
