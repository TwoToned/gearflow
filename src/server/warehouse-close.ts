"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { requirePermission } from "@/lib/org-context";
import { getModelMap } from "@/lib/models-read";
import { getProjectById } from "@/lib/projects-read";
import { getWarehouseCloseByProject } from "@/lib/warehouse-close-read";
import { getAssetsByOrg, getBulkAssetsByOrg } from "@/lib/assets-read";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  warehouseCloseSchema,
  type WarehouseCloseFormValues,
} from "@/lib/validations/check-item";

// ─── Close-Out Summary ──────────────────────────────────────────────────────

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

// ─── Close Out Project ──────────────────────────────────────────────────────

export async function closeOutProject(data: WarehouseCloseFormValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "close"
  );
  const parsed = warehouseCloseSchema.parse(data);

  const project = await getProjectById(parsed.projectId);
  if (!project || project.organizationId !== organizationId || project.isTemplate) {
    throw new Error("Project not found");
  }

  // projectLineItem is Convex-only — read this project's lines once and apply
  // the type/isKitChild/status where-filters in JS.
  const convex = await getConvexClient();
  const projectLines = (
    await convex.query(api.projectLineItems.listByProject, {
      projectId: parsed.projectId,
      orgId: organizationId,
    })
  ).filter((li) => li.type === "EQUIPMENT" && li.isKitChild !== true);

  // Verify all items are in a terminal state (returned)
  const pendingItems = projectLines.filter(
    (li) => li.status !== "RETURNED" && li.status !== "CANCELLED",
  ).length;

  if (pendingItems > 0) {
    throw new Error(
      `Cannot close: ${pendingItems} item${pendingItems === 1 ? "" : "s"} still not returned`
    );
  }

  // Get counts for the close record
  const lineItems = projectLines.filter((li) => li.status === "RETURNED");

  const storedCount = lineItems.filter(
    (i) => !i.returnCondition || i.returnCondition === "GOOD"
  ).length;
  const damagedCount = lineItems.filter(
    (i) => i.returnCondition === "DAMAGED"
  ).length;
  const lostCount = lineItems.filter(
    (i) => i.returnCondition === "MISSING"
  ).length;

  // warehouseCloses is Convex-only (Phase C). The [projectId, organizationId]
  // uniqueness invariant the old Prisma unique constraint enforced now lives in
  // the closeOutIfNotClosed mutation (race-safe via Convex serializable OCC).
  const id = createId();
  const closedAt = Date.now();
  const { alreadyClosed } = await (await getConvexClient()).mutation(
    api.warehouseCloses.closeOutIfNotClosed,
    {
      id,
      organizationId,
      projectId: parsed.projectId,
      closedById: userId,
      closedAt,
      storedCount,
      damagedCount,
      lostCount,
    },
  );
  if (alreadyClosed) {
    throw new Error("Project has already been closed out");
  }

  const result = {
    id,
    organizationId,
    projectId: parsed.projectId,
    closedById: userId,
    closedAt: new Date(closedAt),
    storedCount,
    damagedCount,
    lostCount,
    project: { name: project.name, projectNumber: project.projectNumber },
    closedBy: { name: userName },
  };

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "project",
    entityId: parsed.projectId,
    entityName: project.name,
    summary: `Closed out warehouse for "${project.name}" — ${storedCount} stored, ${damagedCount} damaged, ${lostCount} lost`,
    projectId: parsed.projectId,
  });

  return serialize(result);
}

// ─── Batch Close Out ────────────────────────────────────────────────────────

export async function batchCloseOut(projectIds: string[]) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "close"
  );

  if (projectIds.length === 0) {
    throw new Error("No projects selected");
  }

  if (projectIds.length > 25) {
    throw new Error("Maximum 25 projects per batch close-out");
  }

  const results: Array<{
    projectId: string;
    projectName: string;
    success: boolean;
    error?: string;
  }> = [];

  for (const projectId of projectIds) {
    const projectForName = await getProjectById(projectId);
    const projectName = projectForName?.name || projectId;
    try {
      await closeOutProject({ projectId });
      results.push({ projectId, projectName, success: true });
    } catch (error) {
      results.push({
        projectId,
        projectName,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  if (successCount > 0) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "project",
      entityId: projectIds[0],
      entityName: `Batch close-out`,
      summary: `Batch closed ${successCount} of ${projectIds.length} projects`,
    });
  }

  return serialize(results);
}
