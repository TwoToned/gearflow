"use client";

import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared scan-feedback toggle button — ghost icon button, Volume2/VolumeX,
 * matching the original T&T quick-test toggle. Every scan-verdict surface
 * (Warehouse prep/deploy/return, T&T quick-test, `/check/[assetTag]`) renders
 * this so the on/off control is visually and behaviourally identical
 * everywhere. Covers both audio and haptics (D5, #1220) — kept the
 * `Volume2`/`VolumeX` glyphs since no better two-state icon exists for
 * "both", and audio is the half people notice.
 *
 * See `useScanFeedback` (`@/hooks/use-scan-feedback`) for the underlying
 * localStorage-persisted toggle state, and FEATUREDOCS/12 / FEATUREDOCS/14 for
 * the architecture.
 */
export function ScanFeedbackToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      title={enabled ? "Disable feedback" : "Scan feedback"}
      aria-label={enabled ? "Disable feedback" : "Scan feedback"}
    >
      {enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
    </Button>
  );
}
