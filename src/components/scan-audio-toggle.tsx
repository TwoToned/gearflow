"use client";

import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared scan-audio toggle button — ghost icon button, Volume2/VolumeX, matching
 * the original T&T quick-test toggle. Every scan-verdict surface (Warehouse
 * prep/deploy/return, T&T quick-test, `/check/[assetTag]`) renders this so the
 * on/off control is visually and behaviourally identical everywhere.
 *
 * See `useScanFeedback` (`@/hooks/use-scan-feedback`) for the underlying
 * localStorage-persisted toggle state, and FEATUREDOCS/12 / FEATUREDOCS/14 for
 * the architecture.
 */
export function ScanAudioToggle({
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
      title={enabled ? "Disable audio" : "Enable audio"}
      aria-label={enabled ? "Disable audio" : "Enable audio"}
    >
      {enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
    </Button>
  );
}
