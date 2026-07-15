"use server";

import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { requirePermission } from "@/lib/org-context";
import { getModelMap } from "@/lib/models-read";
import { getProjectById } from "@/lib/projects-read";
import { getWarehouseCloseByProject } from "@/lib/warehouse-close-read";
import { getAssetsByOrg, getBulkAssetsByOrg } from "@/lib/assets-read";
import { serialize } from "@/lib/serialize";

/**
 * Close-out summary READ (relocated out of the deleted src/server/warehouse-close.ts,
 * whose closeOutProject/batchCloseOut writes are now browser-direct — see
 * convex/warehouseCloseWrites.ts + src/hooks/use-warehouse-close-writes.ts).
 *
 * This stays a server action because it composes a Prisma read (the closer's display
 * name from the kept Postgres `user` table — auth stays on Prisma) on top of the
 * Convex line-item / model / asset / warehouse-close reads. A future full-native
 * re-home is possible (the `users` mirror carries name/email, so the closer name
 * could come from Convex), but the model-name + asset-tag composition makes a native
 * composite non-trivial and is out of scope for the write migration.
 */
export async function getCloseOutSummary(projectId: string) {
  const { organizationId } = await requirePermission("warehouse", "close");

  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId || project.isTemplate) {
    throw new Error("Project not found");
  }

  // Get all equipment line items (top-level only, excluding kit children).
  // projectLineItem is Convex-only — read by project then replicate the
  // type/isKitChild where-filter in JS.
  const convex = await getConvexClient();
  const allLines = await convex.query(api.projectLineItems.listByProject, {
    projectId,
    orgId: organizationId,
  });
  const lineItems = allLines.filter(
    (li) => li.type === "EQUIPMENT" && li.isKitChild !== true,
  );
  // model name lives in Convex — resolve from the map, not a Prisma join.
  const modelMap = await getModelMap(organizationId);
  // asset tags live on Convex assets — resolve assetId/bulkAssetId → assetTag
  // (replaces the old Prisma asset/bulkAsset joins).
  const [assets, bulkAssets] = await Promise.all([
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
  ]);
  const assetTagMap = new Map(assets.map((a) => [a.id, a.assetTag]));
  const bulkAssetTagMap = new Map(bulkAssets.map((b) => [b.id, b.assetTag]));

  // Categorize items
  let storedCount = 0;
  let damagedCount = 0;
  let lostCount = 0;
  let pendingCount = 0;
  const exceptions: Array<{
    lineItemId: string;
    modelName: string;
    assetTag: string | null;
    status: string;
    returnCondition: string | null;
    returnStatus: string | null;
  }> = [];

  for (const item of lineItems) {
    const isReturned = item.status === "RETURNED";
    const modelName = (item.modelId ? modelMap.get(item.modelId)?.name : null) || "Unknown";
    const assetTag =
      (item.assetId ? assetTagMap.get(item.assetId) : null) ||
      (item.bulkAssetId ? bulkAssetTagMap.get(item.bulkAssetId) : null) ||
      null;
    // Convex fields are optional; normalize for the exceptions shape (status was a
    // non-null Prisma column — default to PENDING when absent).
    const status = item.status ?? "PENDING";
    const returnCondition = item.returnCondition ?? null;
    const returnStatus = item.returnStatus ?? null;

    if (!isReturned) {
      pendingCount++;
      exceptions.push({
        lineItemId: item.id,
        modelName,
        assetTag,
        status,
        returnCondition,
        returnStatus,
      });
      continue;
    }

    switch (item.returnStatus) {
      case "DAMAGED":
        damagedCount++;
        exceptions.push({
          lineItemId: item.id,
          modelName,
          assetTag,
          status,
          returnCondition,
          returnStatus,
        });
        break;
      case "LOST":
        lostCount++;
        exceptions.push({
          lineItemId: item.id,
          modelName,
          assetTag,
          status,
          returnCondition,
          returnStatus,
        });
        break;
      case "STORED":
        storedCount++;
        break;
      default:
        // RETURNED but not yet stored/damaged/lost — still counts as pending
        if (item.returnCondition === "GOOD") {
          storedCount++;
        } else if (item.returnCondition === "DAMAGED") {
          damagedCount++;
          exceptions.push({
            lineItemId: item.id,
            modelName,
            assetTag,
            status,
            returnCondition,
            returnStatus,
          });
        } else if (item.returnCondition === "MISSING") {
          lostCount++;
          exceptions.push({
            lineItemId: item.id,
            modelName,
            assetTag,
            status,
            returnCondition,
            returnStatus,
          });
        } else {
          pendingCount++;
          exceptions.push({
            lineItemId: item.id,
            modelName,
            assetTag,
            status,
            returnCondition,
            returnStatus,
          });
        }
        break;
    }
  }

  // Check if already closed — warehouseCloses is Convex-only since Phase C. The
  // closer's display name comes from the kept Postgres `user` table (auth stays
  // on Prisma), not a Convex join.
  const existingClose = await getWarehouseCloseByProject(organizationId, projectId);
  const closedByName = existingClose
    ? (
        await prisma.user.findUnique({
          where: { id: existingClose.closedById },
          select: { name: true },
        })
      )?.name ?? null
    : null;

  return serialize({
    project,
    totalItems: lineItems.length,
    storedCount,
    damagedCount,
    lostCount,
    pendingCount,
    exceptions,
    canClose: pendingCount === 0,
    alreadyClosed: !!existingClose,
    closedAt:
      existingClose?.closedAt != null ? new Date(existingClose.closedAt) : null,
    closedBy: closedByName,
  });
}
