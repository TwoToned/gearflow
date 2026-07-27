"use client";

/**
 * Stale-price banner (#943) — the project detail page's affordance for the
 * "rental-date edit never silently reprices anything" rule. When a rental-date
 * change leaves auto-priced lines' stored `priceBreakdown` out of sync with
 * what the CURRENT dates would derive, `projectPricingStaleness` reports a
 * non-zero count and this banner appears with an explicit "Recalculate"
 * button. Nothing recomputes on its own — recalcAutoPricedLinesNative only
 * ever runs from this click. Renders nothing when nothing is stale (zero
 * noise on a clean project — mirrors ProjectConflictsBanner's shape).
 */

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useProjectPricingStaleness, useRecalcAutoPricedLines } from "@/hooks/use-billing-summary";
import { showError } from "@/lib/show-error";

interface StalePricingBannerProps {
  projectId: string;
  orgId: string | undefined;
}

export function StalePricingBanner({ projectId, orgId }: StalePricingBannerProps) {
  const [recalculating, setRecalculating] = useState(false);
  const staleLineCount = useProjectPricingStaleness(projectId, orgId);
  const { recalc } = useRecalcAutoPricedLines(orgId);

  if (staleLineCount === 0) return null;

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const { linesUpdated } = await recalc(projectId);
      toast.success("Pricing recalculated", {
        description: `Updated ${linesUpdated} line item${linesUpdated === 1 ? "" : "s"} for the current rental dates.`,
      });
    } catch (e) {
      showError(e);
    } finally {
      setRecalculating(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="min-w-0 flex-1 text-sm text-amber-700 dark:text-amber-300">
          Rates derived from old dates — {staleLineCount} line item{staleLineCount === 1 ? "" : "s"} need
          recalculating.
        </span>
        <Button
          variant="line"
          size="sm"
          className="h-7 shrink-0"
          disabled={recalculating}
          onClick={handleRecalculate}
        >
          {recalculating && <Loader2 className="mr-1 size-3 animate-spin" />}
          Recalculate
        </Button>
      </div>
    </div>
  );
}
