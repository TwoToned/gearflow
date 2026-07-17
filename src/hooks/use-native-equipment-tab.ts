"use client";

import { useMemo } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useProject } from "@/hooks/use-projects";
import { api } from "../../convex/_generated/api";
import {
  reconstructProjectCategories,
  reconstructUncategorizedLineItems,
  reconstructUncategorizedSubHireGroups,
  reconstructUncategorizedProjectGroups,
  reconstructProjectSubHires,
  reconstructOverbookedRecord,
  type ProjectSubHireSummary,
} from "@/lib/equipment-tab-reconstruct";
import type {
  CategoryData,
  GroupData,
  SubHireGroupData,
  LineItemData,
} from "@/components/projects/equipment-rows";
import type { OverbookedInfo } from "@/lib/overbooking-core";
import { applyOptimisticEdits, type OptimisticLineEdit } from "@/hooks/use-native-line-item-writes";

export interface NativeEquipmentTab {
  categories: CategoryData[];
  uncategorizedItems: LineItemData[];
  uncategorizedSubHireGroups: SubHireGroupData[];
  uncategorizedProjectGroups: GroupData[];
  overbookedMap: Record<string, OverbookedInfo>;
  projectSubHires: ProjectSubHireSummary[];
  isLoading: boolean;
}

const toDate = (n: number | null | undefined): Date | null =>
  typeof n === "number" ? new Date(n) : null;

/**
 * Native equipment editing tab: ONE `equipmentTab.bundle` subscription (+
 * `overbooking.bundle` for the overbooked view) reconstructs all six views the
 * tab's server actions returned — reactive over the WebSocket, no doorbell→refetch.
 * Skips entirely unless the flag is on and ids are present (so the hook is a no-op
 * when the flag is off — equipment-tab keeps its server-action path).
 *
 * Cross-tab liveness is automatic: writes are still server actions, but each calls
 * convex.mutation, which pushes the delta to this useQuery subscription — the
 * `useProjectEquipmentLiveSync` doorbell is no longer needed on this path.
 */
export function useNativeEquipmentTab(
  projectId: string | undefined,
  orgId: string | undefined,
  optimisticEdits?: ReadonlyMap<string, OptimisticLineEdit>,
): NativeEquipmentTab {
  const enabled = !!projectId && !!orgId;
  const rawBundle = useAuthedQuery(
    api.equipmentTab.bundle,
    enabled ? { projectId: projectId!, orgId: orgId! } : "skip",
  );

  // Overlay optimistic line-item edits (Phase 5d) onto the raw bundle BEFORE
  // reconstruction, so an edited row updates instantly. Cleared by the caller once
  // the server write settles; a no-op when there are none. See use-native-line-item-writes.ts.
  const bundle = useMemo(() => {
    if (!rawBundle || !optimisticEdits || optimisticEdits.size === 0) return rawBundle;
    return { ...rawBundle, lineItems: applyOptimisticEdits(rawBundle.lineItems, optimisticEdits) };
  }, [rawBundle, optimisticEdits]);

  // The project doc supplies the rental window the overbooked computation needs.
  const project = useProject(enabled ? projectId : undefined);

  // Overbooked: referenced models from the FLAT non-cancelled line items (mirrors
  // getProjectOverbookedStatus's modelIds AND relevantOverbookModelIds). Skip the
  // subscription when none. `.sort()` matches relevantOverbookModelIds so the
  // overbooking.bundle args are byte-identical to useNativeProjectDetail's on the
  // same page → Convex's query cache serves ONE subscription instead of two
  // (halves this query's Database I/O). See relevantOverbookModelIds.
  const modelIds = useMemo(() => {
    if (!bundle) return undefined;
    return [
      ...new Set(
        bundle.lineItems
          .filter((li) => li.modelId && li.status !== "CANCELLED" && li.subHireId == null)
          .map((li) => li.modelId!),
      ),
    ].sort();
  }, [bundle]);
  const overbooking = useAuthedQuery(
    api.overbooking.bundle,
    enabled && orgId && modelIds && modelIds.length > 0
      ? {
          orgId: orgId!,
          modelIds,
          thisProjectId: projectId!,
          rentalStartDate: project?.rentalStartDate ?? undefined,
          rentalEndDate: project?.rentalEndDate ?? undefined,
        }
      : "skip",
  );

  const categories = useMemo(
    () => (bundle ? reconstructProjectCategories(bundle) : []),
    [bundle],
  );
  const uncategorizedItems = useMemo(
    () => (bundle ? reconstructUncategorizedLineItems(bundle) : []),
    [bundle],
  );
  const uncategorizedSubHireGroups = useMemo(
    () => (bundle ? reconstructUncategorizedSubHireGroups(bundle) : []),
    [bundle],
  );
  const uncategorizedProjectGroups = useMemo(
    () => (bundle ? reconstructUncategorizedProjectGroups(bundle) : []),
    [bundle],
  );
  const projectSubHires = useMemo(
    () => (bundle ? reconstructProjectSubHires(bundle) : []),
    [bundle],
  );
  const overbookedMap = useMemo(
    () =>
      bundle && projectId
        ? reconstructOverbookedRecord(
            bundle,
            overbooking ?? undefined,
            toDate(project?.rentalStartDate),
            toDate(project?.rentalEndDate),
            projectId,
          )
        : {},
    [bundle, overbooking, project?.rentalStartDate, project?.rentalEndDate, projectId],
  );

  return {
    categories,
    uncategorizedItems,
    uncategorizedSubHireGroups,
    uncategorizedProjectGroups,
    overbookedMap,
    projectSubHires,
    isLoading: enabled && bundle === undefined,
  };
}
