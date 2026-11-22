"use client";

import { Button } from "@/components/ui/button";

/**
 * The Versions tab body until Phase 8 builds the real one (D19: Versions
 * becomes a job tab). It keeps `?tab=versions` from landing on an empty page:
 * it opens today's Versions panel, where every version verb still lives.
 * Phase 8 replaces this file (or its one entry in the page's panel map).
 */
export function VersionsTabPlaceholder({ onOpenVersions }: { onOpenVersions: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4 text-table-cell text-muted">
      <p>Every version of this job, with Make live, Compare, rename and delete, is in the Versions panel.</p>
      <Button type="button" variant="line" size="sm" onClick={onOpenVersions}>
        Manage versions…
      </Button>
    </div>
  );
}
