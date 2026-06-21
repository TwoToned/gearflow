"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { createId } from "@paralleldrive/cuid2";
import { getModelMap } from "@/lib/models-read";
import {
  aggregateCheckInTotals,
  itemGroupKey,
  distributeReturn,
  type CheckInItem,
  type CheckInItemType,
  type BulkCheckInTotal,
} from "@/lib/bulk-checkin";

type ReturnCondition = "GOOD" | "DAMAGED" | "MISSING";

const UNIT_SELECT = {
  quantity: true,
  returnedQuantity: true,
  status: true,
} as const;

type DeployedItemRow = {
  id: string;
  modelId: string | null;
  sortOrder: number;
  assetId: string | null;
  bulkAssetId: string | null;
  subHireId: string | null;
  isCustomItem: boolean;
  childKind: string | null;
  checkedOutQuantity: number;
  returnedQuantity: number;
  status: string;
  model: { name: string; modelNumber: string | null } | null;
  units: Array<{ quantity: number; returnedQuantity: number; status: string }>;
};

function childOutstanding(child: DeployedItemRow): number {
  if (child.units.length > 0) {
    return child.units.reduce(
      (sum, u) =>
        u.status === "CHECKED_OUT"
          ? sum + Math.max(0, u.quantity - u.returnedQuantity)
          : sum,
      0,
    );
  }
  if (child.status !== "CHECKED_OUT") return 0;
  return Math.max(0, child.checkedOutQuantity - child.returnedQuantity);
}

function toInput(child: DeployedItemRow): CheckInItem {
  let itemType: CheckInItemType;
  if (child.childKind === "ACCESSORY") itemType = "ACCESSORY";
  else if (child.isCustomItem) itemType = "CUSTOM";
  else if (child.subHireId) itemType = "SUBHIRE";
  else if (child.bulkAssetId) itemType = "OWNED_BULK";
  else itemType = "OWNED_SERIALISED";

  return {
    lineItemId: child.id,
    modelId: child.modelId,
    modelName: child.model?.name ?? null,
    modelNumber: child.model?.modelNumber ?? null,
    assetId: child.assetId,
    bulkAssetId: child.bulkAssetId,
    subHireId: child.subHireId,
    isCustomItem: child.isCustomItem,
    childKind: child.childKind,
    sortOrder: child.sortOrder,
    outstanding: childOutstanding(child),
    itemType,
  };
}

async function loadDeployedItems(
  organizationId: string,
  projectId: string,
): Promise<DeployedItemRow[]> {
  const convex = await getConvexClient();
  const [allLines, modelMap] = await Promise.all([
    convex.query(api.projectLineItems.listByProject, { projectId, orgId: organizationId }),
    getModelMap(organizationId),
  ]);

  // Replicate the Prisma `where`: deployed, non-sub-hire-group, and either a
  // non-kit-child OR an accessory child.
  const rows = allLines
    .filter(
      (r) =>
        r.organizationId === organizationId &&
        r.status === "CHECKED_OUT" &&
        !r.subHireGroupId &&
        (!r.isKitChild || r.childKind === "ACCESSORY"),
    )
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  // Units per line (batched).
  const unitsByLine = new Map<string, Array<{ quantity: number; returnedQuantity: number; status: string }>>();
  const allUnits = await convex.query(api.projectLineItemUnits.listByLineItemIds, {
    lineItemIds: rows.map((r) => r.id),
  });
  for (const u of allUnits) {
    const bucket = unitsByLine.get(u.lineItemId) ?? [];
    bucket.push({ quantity: u.quantity ?? 0, returnedQuantity: u.returnedQuantity ?? 0, status: u.status ?? "" });
    unitsByLine.set(u.lineItemId, bucket);
  }

  return rows.map((r) => ({
    id: r.id,
    modelId: r.modelId ?? null,
    sortOrder: r.sortOrder ?? 0,
    assetId: r.assetId ?? null,
    bulkAssetId: r.bulkAssetId ?? null,
    subHireId: r.subHireId ?? null,
    isCustomItem: !!r.isCustomItem,
    childKind: r.childKind ?? null,
    checkedOutQuantity: r.checkedOutQuantity ?? 0,
    returnedQuantity: r.returnedQuantity ?? 0,
    status: r.status ?? "",
    model: r.modelId
      ? { name: modelMap.get(r.modelId)?.name ?? null, modelNumber: modelMap.get(r.modelId)?.modelNumber ?? null }
      : null,
    units: unitsByLine.get(r.id) ?? [],
  })) as DeployedItemRow[];
}

export async function getBulkCheckInTotals(
  projectId: string,
): Promise<BulkCheckInTotal[]> {
  const { organizationId } = await getOrgContext();
  const items = await loadDeployedItems(organizationId, projectId);
  return serialize(aggregateCheckInTotals(items.map(toInput)));
}

export async function checkInBulkTotals(
  projectId: string,
  returns: Array<{ key: string; quantity: number; condition?: ReturnCondition }>,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_in",
  );

  const wanted = (returns ?? []).filter(
    (r) => r && typeof r.quantity === "number" && r.quantity > 0,
  );
  if (wanted.length === 0) {
    return serialize({ returned: [] as Array<{ key: string; quantity: number }> });
  }

  // The whole distribute-and-return flow (deployed-item load, group bucketing,
  // unit returns + rollup, asset status flips, scan logs) is now ONE atomic
  // Convex mutation. Permissions + activity-log stay here.
  const convex = await getConvexClient();
  const { returned } = await convex.mutation(api.warehouseOps.checkInBulkTotals, {
    organizationId,
    projectId,
    userId,
    returns: wanted.map((r) => ({
      key: r.key,
      quantity: r.quantity,
      ...(r.condition ? { condition: r.condition } : {}),
    })),
    now: Date.now(),
  });

  for (const r of returned) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CHECK_IN",
      entityType: "project",
      entityId: projectId,
      entityName: `Project ${projectId}`,
      summary: `Bulk check-in: returned ${r.quantity}x ${r.key} (condition: ${r.condition})`,
      projectId,
    });
  }

  return serialize({ returned });
}
