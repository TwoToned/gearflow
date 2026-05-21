"use server";

/**
 * Reservation conflict server actions (Wave 3).
 *
 * Thin wrappers over the pure helpers in src/lib/reservation-conflicts.ts.
 * Read paths gate on `project:read`; the swap mutation gates on
 * `project:manage_line_items` (it reassigns a line item's asset).
 */

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { UserFacingError } from "@/lib/errors";
import {
  findProjectConflictsCore,
  findSwapCandidatesCore,
  swapLineItemAssetCore,
  type ReservationConflict,
  type SwapCandidate,
} from "@/lib/reservation-conflicts";

export type { ReservationConflict, SwapCandidate };

export async function getProjectConflicts(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");
  const conflicts = await findProjectConflictsCore(projectId, organizationId);
  return serialize(conflicts);
}

export async function getSwapCandidates(lineItemId: string) {
  const { organizationId } = await requirePermission("project", "read");
  const candidates = await findSwapCandidatesCore(lineItemId, organizationId);
  return serialize(candidates);
}

export async function swapLineItemAsset(lineItemId: string, newAssetId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items",
  );

  let result;
  try {
    result = await swapLineItemAssetCore(lineItemId, newAssetId, organizationId);
  } catch (e) {
    // The core throws plain Errors for validation failures — surface them
    // as structured UserFacingError so the toast reads cleanly.
    throw new UserFacingError({
      code: "SWAP_FAILED",
      title: "Couldn't swap the asset",
      message: e instanceof Error ? e.message : "The swap could not be completed.",
      hint: "Refresh the conflict list — another booking may have changed.",
    });
  }

  // Look up the line item's project for the activity log.
  const lineItem = await prisma.projectLineItem.findUnique({
    where: { id: lineItemId, organizationId },
    select: { projectId: true, asset: { select: { assetTag: true } } },
  });

  if (lineItem?.projectId) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "project",
      entityId: lineItem.projectId,
      projectId: lineItem.projectId,
      entityName: lineItem.asset?.assetTag ?? "line item",
      summary: `Swapped a conflicting line item onto asset ${lineItem.asset?.assetTag ?? newAssetId}`,
    });
  }

  return serialize(result);
}
