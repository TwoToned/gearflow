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

/**
 * Feature flag (default OFF) for the native equipment-tab read cutover (Phase 2).
 * Until "true" in the build env, equipment-tab keeps its six server-action shared
 * resources — so merging the cutover changes nothing for users. Inlined at build
 * time, so flipping it needs the Dockerfile/build-image build-arg + repo var.
 */
export const NATIVE_EQUIPMENT_ENABLED =
  process.env.NEXT_PUBLIC_NATIVE_EQUIPMENT === "true";

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
): NativeEquipmentTab {
  const enabled = NATIVE_EQUIPMENT_ENABLED && !!projectId && !!orgId;
  const bundle = useAuthedQuery(
    api.equipmentTab.bundle,
    enabled ? { projectId: projectId!, orgId: orgId! } : "skip",
  );

  // The project doc supplies the rental window the overbooked computation needs.
  const project = useProject(enabled ? projectId : undefined);

  // Overbooked: referenced models from the FLAT non-cancelled line items (mirrors
  // getProjectOverbookedStatus's modelIds). Skip the subscription when none.
  const modelIds = useMemo(() => {
    if (!bundle) return undefined;
    return [
      ...new Set(
        bundle.lineItems
          .filter((li) => li.modelId && li.status !== "CANCELLED" && li.subHireId == null)
          .map((li) => li.modelId!),
      ),
    ];
  }, [bundle]);
  const overbooking = useAuthedQuery(
    api.overbooking.bundle,
    enabled && orgId && modelIds && modelIds.length > 0
      ? { orgId: orgId!, modelIds }
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
