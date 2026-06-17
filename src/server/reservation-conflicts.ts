"use server";

/**
 * Reservation conflict server actions (Wave 3).
 *
 * Thin wrappers over the pure helpers in src/lib/reservation-conflicts.ts.
 * Read paths gate on `project:read`; the swap mutation gates on
 * `project:manage_line_items` (it reassigns a line item's asset).
 */

import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { UserFacingError } from "@/lib/errors";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getAssetById } from "@/lib/assets-read";
import {
  findProjectConflictsCore,
  findSwapCandidatesCore,
  swapLineItemAssetCore,
} from "@/lib/reservation-conflicts";

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

  // Look up the line item's project for the activity log (pure read — feeds only
  // the activity log, no mutation). Both the line item and the (now-swapped-on)
  // asset live in the Convex mirror. The line item's asset is `newAssetId` after
  // the swap, so resolve the tag from that asset directly.
  const convex = await getConvexClient();
  const lineItem = await convex.query(api.projectLineItems.getById, { id: lineItemId });
  const projectId = lineItem?.organizationId === organizationId ? lineItem.projectId : null;
  const newAsset = await getAssetById(newAssetId);
  const assetTag = newAsset?.assetTag ?? null;

  if (projectId) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "project",
      entityId: projectId,
      projectId,
      entityName: assetTag ?? "line item",
      summary: `Swapped a conflicting line item onto asset ${assetTag ?? newAssetId}`,
    });
  }

  return serialize(result);
}
