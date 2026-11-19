"use client";

import { useMemo } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useProject } from "@/hooks/use-projects";
import { api } from "../../convex/_generated/api";
import { reconstructOverbookedStatus, type OverbookedInfo, type OverbookLineItem } from "@/lib/overbooking-core";
import { getProjectWindow } from "@/lib/project-window";

const toDate = (n: number | null | undefined): Date | null => (typeof n === "number" ? new Date(n) : null);

/** The slice of a warehouse line the overbooked computation reads. */
type WarehouseLine = OverbookLineItem & { childLineItems?: WarehouseLine[] | null; subHireId?: string | null };

function flatten(lines: WarehouseLine[]): WarehouseLine[] {
  return lines.flatMap((l) => [l, ...flatten(l.childLineItems ?? [])]);
}

/**
 * `lineItemId → OverbookedInfo` for the warehouse screen, so the pick/prep tab can
 * offer "Prep as custom item" on a short line. Same `overbooking.bundle` args as the
 * Equipment tab's hook (sorted model ids, project window) → Convex serves one
 * cached subscription when both are mounted.
 */
export function useWarehouseOverbooked(
  orgId: string | undefined,
  projectId: string | undefined,
  lines: WarehouseLine[],
): Record<string, OverbookedInfo> {
  const project = useProject(orgId && projectId ? projectId : undefined);
  const window = useMemo(() => (project ? getProjectWindow(project) : { start: null, end: null }), [project]);
  const flat = useMemo(() => flatten(lines).filter((l) => l.status !== "CANCELLED"), [lines]);
  const modelIds = useMemo(
    () => [...new Set(flat.filter((l) => l.modelId && l.subHireId == null).map((l) => l.modelId!))].sort(),
    [flat],
  );
  const overbooking = useAuthedQuery(
    api.overbooking.bundle,
    orgId && projectId && modelIds.length > 0
      ? {
          orgId,
          modelIds,
          thisProjectId: projectId,
          rentalStartDate: window.start ?? undefined,
          rentalEndDate: window.end ?? undefined,
        }
      : "skip",
  );
  return useMemo(
    () =>
      overbooking && projectId
        ? Object.fromEntries(reconstructOverbookedStatus(overbooking, flat, toDate(window.start), toDate(window.end), projectId))
        : {},
    [overbooking, flat, window, projectId],
  );
}
