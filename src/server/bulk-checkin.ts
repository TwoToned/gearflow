"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  returnLineUnits,
  syncLineItemRollup,
} from "@/lib/line-item-fulfillment";
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
  return prisma.projectLineItem.findMany({
    where: {
      organizationId,
      projectId,
      status: "CHECKED_OUT",
      subHireGroupId: null,
      OR: [
        { isKitChild: false },
        { isKitChild: true, childKind: "ACCESSORY" },
      ],
    },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      modelId: true,
      sortOrder: true,
      assetId: true,
      bulkAssetId: true,
      subHireId: true,
      isCustomItem: true,
      childKind: true,
      checkedOutQuantity: true,
      returnedQuantity: true,
      status: true,
      model: { select: { name: true, modelNumber: true } },
      units: { select: UNIT_SELECT },
    },
  });
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

  const returned = await prisma.$transaction(async (tx) => {
    const defaultLocation = await tx.location.findFirst({
      where: { organizationId, isDefault: true },
      select: { id: true },
    });
    const defaultLocationId = defaultLocation?.id ?? null;

    const items = (await tx.projectLineItem.findMany({
      where: {
        organizationId,
        projectId,
        status: "CHECKED_OUT",
        subHireGroupId: null,
        OR: [
          { isKitChild: false },
          { isKitChild: true, childKind: "ACCESSORY" },
        ],
      },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        modelId: true,
        sortOrder: true,
        assetId: true,
        bulkAssetId: true,
        subHireId: true,
        isCustomItem: true,
        childKind: true,
        checkedOutQuantity: true,
        returnedQuantity: true,
        status: true,
        model: { select: { name: true, modelNumber: true } },
        units: { select: UNIT_SELECT },
      },
    })) as DeployedItemRow[];

    const byKey = new Map<string, CheckInItem[]>();
    const labelByKey = new Map<string, string>();
    for (const item of items) {
      const input = toInput(item);
      const key = itemGroupKey(input);
      if (!key) continue;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(input);
      else byKey.set(key, [input]);
      if (!labelByKey.has(key)) labelByKey.set(key, input.modelName ?? (input.itemType === "ACCESSORY" ? "Accessory" : "Item"));
    }

    const summary: Array<{ key: string; quantity: number; condition: ReturnCondition }> = [];

    for (const req of wanted) {
      const condition: ReturnCondition = req.condition ?? "GOOD";
      const groupChildren = byKey.get(req.key) ?? [];
      const { allocations, distributed } = distributeReturn(groupChildren, req.quantity);

      if (distributed < req.quantity) {
        const available = groupChildren.reduce((s, c) => s + Math.max(0, c.outstanding), 0);
        throw new Error(
          `Cannot return ${req.quantity} of "${labelByKey.get(req.key) ?? req.key}" — only ${available} currently deployed.`,
        );
      }

      const assetsTouched: string[] = [];

      for (const alloc of allocations) {
        if (alloc.itemType === "SUBHIRE" || alloc.itemType === "CUSTOM") {
          const line = await tx.projectLineItem.findUnique({
            where: { id: alloc.lineItemId },
            select: { checkedOutQuantity: true, returnedQuantity: true },
          });
          const newReturned = (line?.returnedQuantity ?? 0) + alloc.quantity;
          const isFullyReturned = newReturned >= (line?.checkedOutQuantity ?? 0);
          await tx.projectLineItem.update({
            where: { id: alloc.lineItemId },
            data: {
              status: isFullyReturned ? "RETURNED" : "CHECKED_OUT",
              returnedQuantity: { increment: alloc.quantity },
              returnCondition: condition,
              // Only stamp the return actor/timestamp once the line is fully
              // back — a partial return shouldn't claim the line is closed out.
              ...(isFullyReturned
                ? { returnedAt: new Date(), returnedById: userId }
                : {}),
            },
          });
          // NB: no syncLineItemRollup here. Sub-hire/custom lines carry no
          // ProjectLineItemUnit rows, so the rollup would recompute every
          // counter from an empty unit set and zero out the checkedOut /
          // returned quantities we just set — making outstanding units
          // invisible. The line-level fields ARE the source of truth here.
          continue;
        }

        const { assetsTouched: touched } = await returnLineUnits(tx, {
          organizationId,
          projectId,
          lineItemId: alloc.lineItemId,
          assetId: alloc.assetId ?? undefined,
          bulkAssetId: alloc.bulkAssetId ?? undefined,
          returnCondition: condition,
          quantity: alloc.quantity,
          userId,
          defaultLocationId,
        });
        await syncLineItemRollup(tx, alloc.lineItemId);
        assetsTouched.push(...touched);
      }

      for (const assetId of assetsTouched) {
        await tx.assetScanLog.create({
          data: {
            organizationId,
            assetId,
            projectId,
            action: "CHECK_IN",
            scannedById: userId,
            notes: `Bulk check-in (${condition})`,
          },
        });
      }
      await tx.assetScanLog.create({
        data: {
          organizationId,
          projectId,
          action: "CHECK_IN",
          scannedById: userId,
          notes: `Bulk check-in: ${distributed}x ${labelByKey.get(req.key) ?? req.key} (${condition})`,
        },
      });

      summary.push({ key: req.key, quantity: distributed, condition });
    }

    return summary;
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
