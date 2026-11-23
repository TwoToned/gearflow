"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useNativeEquipmentTab } from "@/hooks/use-native-equipment-tab";
import { collectPlannableLines, buildPackingBuckets, type PackingContainerBucket, type PlannableLine } from "@/lib/packing-tab";

export interface RealContainer {
  id: string;
  label: string;
  kind?: "ASSET" | "BULK_ASSET" | "CUSTOM";
  parentContainerId?: string | null;
  unitCount: number;
  description?: string | null;
  versionId?: string | null;
  /** Set while the case is sealed (D21): its plan is locked. */
  sealedAt?: number | null;
}

export interface PackingTabData {
  /** Every plannable line (unfiltered); the tab filters and re-buckets. */
  lines: PlannableLine[];
  buckets: PackingContainerBucket[];
  containers: RealContainer[];
  notPlannedCount: number;
  totalCount: number;
  isLoading: boolean;
}

// A stable reference so a still-loading query's fallback doesn't re-key every
// memo below on each render (a fresh `[]` literal would never `===` itself).
const EMPTY_CONTAINERS: RealContainer[] = [];

/**
 * #1296 build plan phase 4 — the Packing tab's own read: the Equipment tab's
 * already-reconstructed tree (model/kit/group attachment reused verbatim,
 * never re-derived) flattened to plannable lines and bucketed by container.
 * Read-only; writes go through `useProjectContainerWrites().setPlannedContainer`.
 */
export function usePackingTab(projectId: string | undefined, orgId: string | undefined, versionId?: string): PackingTabData {
  const equipment = useNativeEquipmentTab(projectId, orgId, undefined, undefined, undefined, undefined, versionId);
  const containers = (useQuery(
    api.projectContainers.listForProject,
    projectId && orgId ? { orgId, projectId, versionId } : "skip",
  ) ?? EMPTY_CONTAINERS) as RealContainer[];

  const containerLabelById = useMemo(() => new Map(containers.map((c) => [c.id, c.label])), [containers]);

  const lines = useMemo(
    () =>
      collectPlannableLines(
        equipment.categories,
        equipment.uncategorizedItems,
        equipment.uncategorizedProjectGroups,
        equipment.uncategorizedSubHireGroups,
      ),
    [equipment.categories, equipment.uncategorizedItems, equipment.uncategorizedProjectGroups, equipment.uncategorizedSubHireGroups],
  );

  const containerIds = useMemo(() => containers.map((c) => c.id), [containers]);
  const buckets = useMemo(
    () => buildPackingBuckets(lines, containerLabelById, containerIds),
    [lines, containerLabelById, containerIds],
  );
  const notPlannedCount = buckets.find((b) => b.containerId === null)?.lines.length ?? 0;

  return {
    lines,
    buckets,
    containers,
    notPlannedCount,
    totalCount: lines.length,
    isLoading: equipment.isLoading,
  };
}
