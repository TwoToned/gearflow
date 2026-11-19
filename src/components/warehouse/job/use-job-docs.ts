"use client";

import { useCallback, useMemo, useState } from "react";
import { useFloorWrites } from "@/components/warehouse/floor/use-floor-writes";
import { adminOverrides } from "@/lib/row-actions/floor-job";
import { useCanDo } from "@/lib/use-permissions";
import { floorCounts, type FloorLine } from "../../../../convex/lib/warehouseStage";

/**
 * The warehouse job page's two Phase 4 hooks-ups (approved minimal edits):
 *  - the Admin overrides, from the SAME builder the floor card uses (D6), run
 *    through the floor's one status write;
 *  - the pull-sheet dialog, opened by `?doc=pull-sheet` (the old page's
 *    redirect) or `Documents ▾ › Pull sheet`; closing drops `doc` from the URL.
 */
export function useJobDocs(opts: {
  orgId: string | undefined;
  projectId: string;
  status: string | undefined;
  lineItems: readonly FloorLine[];
  initialDoc: string | null;
}) {
  const { orgId, projectId, status, lineItems, initialDoc } = opts;
  const canCheckOut = useCanDo("warehouse", "check_out");
  const writes = useFloorWrites(orgId);
  const [pullSheetOpen, setPullSheetOpen] = useState(initialDoc === "pull-sheet");

  const overrides = useMemo(
    () => (status ? adminOverrides({ status, counts: floorCounts(lineItems) }, { canCheckOut, setStatus: (t) => writes.setStatus(projectId, t) }) : []),
    [status, lineItems, canCheckOut, writes, projectId],
  );

  const closePullSheet = useCallback(() => {
    setPullSheetOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("doc");
    window.history.replaceState(null, "", url);
  }, []);

  return {
    overrides,
    pullSheetIds: pullSheetOpen ? [projectId] : null,
    openPullSheet: () => setPullSheetOpen(true),
    closePullSheet,
  };
}
