"use client";

import { Info } from "lucide-react";
import { useProjectVersion } from "@/components/projects/project-version-context";

/**
 * Tasks, Notes (comments) and Files are NOT in the snapshot and never have
 * been (design doc §4.2/decision 16) — they stay live while viewing an older
 * version, labelled as such rather than rendering blank or, worse, live data
 * with no indication it isn't the viewed version's. Renders nothing outside
 * a version-viewing context.
 */
export function VersionNotTrackedNote({ what }: { what: string }) {
  const { isViewingVersion } = useProjectVersion();
  if (!isViewingVersion) return null;

  return (
    <div className="mb-4 flex items-center gap-2 rounded-[var(--r)] border border-line bg-card px-3 py-2 text-caption text-muted">
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{what} aren&apos;t versioned — showing current.</span>
    </div>
  );
}
