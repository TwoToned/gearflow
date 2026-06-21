/**
 * Reservation conflict detection + swap resolution (Wave 3).
 *
 * The "asset already booked" error on addLineItem is a hard stop. This
 * module turns it into something solvable: surface every double-booked
 * asset on a project, and let the operator swap a conflicting line item
 * onto a different free asset of the same model.
 *
 * A conflict, precisely:
 *   - line item LI on project P has assetId set
 *   - the same asset appears on a line item LI2 on a *different* project P2
 *   - P2 is in a live status (not CANCELLED / RETURNED / COMPLETED / INVOICED)
 *   - P and P2 rental windows overlap
 *   - both line items are non-CANCELLED
 *
 * Dateless projects can't conflict (no window to overlap) — skipped.
 *
 * Lives outside `"use server"` so integration tests drive it directly.
 *
 * **Convex read-rewiring (Phase A, Bucket-1).** The PURE conflict-detection
 * reads (`findProjectConflictsCore`, `findSwapCandidatesCore`) read line items +
 * units from the Convex mirror via `reservation-conflicts-read.ts` and replicate
 * the Prisma `where` filters in JS. `swapLineItemAssetCore` STAYS on Prisma — its
 * pre-write line-item lookup and the in-`$transaction` TOCTOU guard reads gate a
 * `tx.projectLineItem.update`, so they must read the store they write inside the
 * same transaction (read-then-write).
 */

import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getModelMap } from "@/lib/models-read";
import { getProjectById, getProjectsByOrg, type ConvexProject } from "@/lib/projects-read";
import { getAssetsByOrg } from "@/lib/assets-read";
import {
  getOrgLineItems,
  getOrgLineItemUnits,
  overlappingProjectIds as overlappingProjectIdSet,
  collectHereAssetRefs,
  buildOverlapByAsset,
  toConflictProject,
  filterSwapCandidateAssets,
  collectBookedAssetIds,
  DEAD_PROJECT_STATUSES,
} from "@/lib/reservation-conflicts-read";

export interface ReservationConflict {
  lineItemId: string;
  assetId: string;
  assetTag: string;
  modelId: string;
  modelName: string;
  /** The other project this asset is also booked on. */
  conflictingProject: {
    id: string;
    projectNumber: string;
    name: string;
    status: string;
    rentalStartDate: Date | null;
    rentalEndDate: Date | null;
  };
  conflictingLineItemId: string;
}

/**
 * Every double-booked asset on the given project. Empty array when the
 * project has no rental window or no conflicts.
 *
 * Fully Convex-read: this project's asset assignments (line.assetId rows AND
 * ProjectLineItemUnit rows), the org's models/assets/projects, and the other
 * projects' overlapping bookings all come from the Convex mirror; the Prisma
 * `where` filters are replicated in JS by the pure helpers.
 */
export async function findProjectConflictsCore(
  projectId: string,
  organizationId: string,
): Promise<ReservationConflict[]> {
  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId) return [];
  if (!project?.rentalStartDate || !project.rentalEndDate) return [];

  const [allLineItems, allUnits, modelMap, allOrgAssets, allProjects] = await Promise.all([
    getOrgLineItems(organizationId),
    getOrgLineItemUnits(organizationId),
    getModelMap(organizationId),
    getAssetsByOrg(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const assetMap = new Map(allOrgAssets.map((a) => [a.id, a]));
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));

  const here = collectHereAssetRefs(projectId, allLineItems, allUnits, assetMap, modelMap);
  if (here.length === 0) return [];

  const assetIds = new Set(here.map((r) => r.assetId));
  // Other live projects overlapping this project's window.
  const conflictProjectIds = overlappingProjectIdSet(
    allProjects,
    project.rentalStartDate as number,
    project.rentalEndDate as number,
    projectId,
  );
  if (conflictProjectIds.size === 0) return [];

  // Overlapping other-project bookings of those assets — both tables.
  const overlapByAsset = buildOverlapByAsset(
    assetIds,
    conflictProjectIds,
    allLineItems,
    allUnits,
  );

  const conflicts: ReservationConflict[] = [];
  const seen = new Set<string>();
  for (const r of here) {
    const overlap = overlapByAsset.get(r.assetId);
    if (!overlap) continue;
    const conflictProject = projectMap.get(overlap.projectId);
    if (!conflictProject) continue;
    const key = `${r.lineItemId}:${r.assetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({
      lineItemId: r.lineItemId,
      assetId: r.assetId,
      assetTag: r.assetTag,
      modelId: r.modelId ?? "",
      modelName: r.modelName,
      conflictingProject: toConflictProject(conflictProject),
      conflictingLineItemId: overlap.id,
    });
  }
  return conflicts;
}

export interface SwapCandidate {
  assetId: string;
  assetTag: string;
  serialNumber: string | null;
  customName: string | null;
  status: string;
}

/**
 * Free same-model assets that the conflicting line item could swap to.
 * "Free" = not booked on any live overlapping project in this project's
 * rental window, not in a kit, not RETIRED / LOST.
 *
 * Fully Convex-read. The line item itself is read from Convex (pure read — its
 * result feeds no mutation here; the actual reassignment lives in
 * `swapLineItemAssetCore`).
 */
export async function findSwapCandidatesCore(
  lineItemId: string,
  organizationId: string,
): Promise<SwapCandidate[]> {
  const [allLineItems, allUnits, allOrgAssets, allProjects] = await Promise.all([
    getOrgLineItems(organizationId),
    getOrgLineItemUnits(organizationId),
    getAssetsByOrg(organizationId),
    getProjectsByOrg(organizationId),
  ]);

  const lineItem = allLineItems.find(
    (l) => l.id === lineItemId && l.organizationId === organizationId,
  );
  if (!lineItem?.modelId) return [];

  // Project header (rental window).
  const lineItemProject = allProjects.find((p) => p.id === lineItem.projectId) ?? null;
  if (!lineItemProject?.rentalStartDate || !lineItemProject.rentalEndDate) {
    return [];
  }
  const startMs = lineItemProject.rentalStartDate as number;
  const endMs = lineItemProject.rentalEndDate as number;

  // All bookable assets of this model.
  const assets = filterSwapCandidateAssets(allOrgAssets, lineItem.modelId);
  if (assets.length === 0) return [];

  // Which of those are booked in an overlapping live project? Bookings live on
  // legacy line.assetId rows AND on ProjectLineItemUnit rows — both checked.
  const candidateAssetIds = new Set(assets.map((a) => a.id));
  const conflictProjectIds = overlappingProjectIdSet(allProjects, startMs, endMs, "");
  const bookedIds = conflictProjectIds.size
    ? collectBookedAssetIds(
        candidateAssetIds,
        conflictProjectIds,
        lineItemId,
        allLineItems,
        allUnits,
      )
    : new Set<string>();

  return assets
    .filter((a) => a.id !== lineItem.assetId && !bookedIds.has(a.id))
    .map((a) => ({
      assetId: a.id,
      assetTag: a.assetTag,
      serialNumber: a.serialNumber ?? null,
      customName: a.customName ?? null,
      status: a.status ?? "",
    }));
}

/**
 * Reassign a line item to a different asset. Re-checks that the target
 * asset is the same model and is genuinely free in the project window —
 * the candidate list could be stale by the time the operator clicks.
 *
 * Returns the updated line item id. Throws a plain Error on validation
 * failure; the server-action wrapper translates to UserFacingError.
 *
 * **Stays on Prisma (read-then-write).** The pre-write line-item lookup and the
 * in-`$transaction` TOCTOU guard reads gate `tx.projectLineItem.update`; they
 * MUST read the same store they write, inside the same transaction. Converting
 * them to a Convex read would re-open the double-booking race this method exists
 * to close (the asset/window context still comes from Convex — only the
 * write-gating booking reads stay Prisma).
 */
export async function swapLineItemAssetCore(
  lineItemId: string,
  newAssetId: string,
  organizationId: string,
): Promise<{ lineItemId: string; assetId: string }> {
  // Pre-checks read Convex for early validation/clear error messages. The
  // authoritative double-booking guard + write live atomically inside the
  // swapLineItemAsset mutation (OCC makes its re-check + write race-safe).
  const convex = await getConvexClient();
  const lineItem = await convex.query(api.projectLineItems.getById, { id: lineItemId });
  if (!lineItem || lineItem.organizationId !== organizationId) throw new Error("Line item not found");

  const allOrgAssetsForSwap = await getAssetsByOrg(organizationId);
  const newAsset = allOrgAssetsForSwap.find((a) => a.id === newAssetId) ?? null;
  if (!newAsset) throw new Error("Target asset not found");

  if (lineItem.modelId && newAsset.modelId !== lineItem.modelId) {
    throw new Error("Target asset is a different model");
  }
  if (newAsset.kitId) {
    throw new Error(`Asset ${newAsset.assetTag} is part of a kit and can't be assigned directly`);
  }
  if (newAsset.status === "RETIRED" || newAsset.status === "LOST") {
    throw new Error(`Asset ${newAsset.assetTag} is ${newAsset.status.toLowerCase()}`);
  }

  // The mutation re-checks free-in-window (line.assetId rows AND unit rows)
  // against live overlapping projects and writes the new assetId in ONE atomic
  // mutation — the TOCTOU guard. Throws ConvexError on a fresh double-booking.
  await convex.mutation(api.projectLineItems.swapLineItemAsset, {
    organizationId,
    lineItemId,
    newAssetId,
    now: Date.now(),
  });

  return { lineItemId, assetId: newAssetId };
}

export { DEAD_PROJECT_STATUSES };
export type { ConvexProject };
