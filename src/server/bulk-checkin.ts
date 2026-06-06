"use server";

/**
 * Bulk Check-In Totals — server actions.
 *
 * Aggregates every DEPLOYED accessory child line item across a project into
 * per-identity totals (one row per bulk asset / per serialised accessory model)
 * and lets the operator return a counted quantity in one action, instead of
 * drilling into each parent. Roadmap Phase 1.3. See FEATUREDOCS/52-bulk-checkin.md.
 *
 * The aggregation + distribution rules live in the pure `@/lib/bulk-checkin`
 * helpers; this module is the IO shell (org scoping, permission, transaction,
 * activity log, serialize).
 */

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  returnLineUnits,
  syncLineItemRollup,
} from "@/server/line-item-fulfillment";
import {
  aggregateAccessoryTotals,
  accessoryGroupKey,
  distributeReturn,
  type AccessoryChildInput,
  type BulkCheckInTotal,
} from "@/lib/bulk-checkin";

type ReturnCondition = "GOOD" | "DAMAGED" | "MISSING";

/** Columns the rollup/outstanding maths needs off each unit row. */
const UNIT_SELECT = {
  quantity: true,
  returnedQuantity: true,
  status: true,
} as const;

type AccessoryChildRow = {
  id: string;
  modelId: string | null;
  sortOrder: number;
  assetId: string | null;
  bulkAssetId: string | null;
  checkedOutQuantity: number;
  returnedQuantity: number;
  status: string;
  model: { name: string; modelNumber: string | null } | null;
  units: Array<{ quantity: number; returnedQuantity: number; status: string }>;
};

/**
 * Outstanding deployed quantity still due back on one accessory child line.
 * Prefer the unit rows (the source of truth post-cutover); fall back to the
 * order line's denormalised counters for any legacy child with no units.
 */
function childOutstanding(child: AccessoryChildRow): number {
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

/** Reduce a DB accessory child row to the pure-helper input shape. */
function toInput(child: AccessoryChildRow): AccessoryChildInput {
  return {
    lineItemId: child.id,
    modelId: child.modelId,
    modelName: child.model?.name ?? null,
    modelNumber: child.model?.modelNumber ?? null,
    assetId: child.assetId,
    bulkAssetId: child.bulkAssetId,
    sortOrder: child.sortOrder,
    outstanding: childOutstanding(child),
  };
}

async function loadAccessoryChildren(
  organizationId: string,
  projectId: string,
): Promise<AccessoryChildRow[]> {
  return prisma.projectLineItem.findMany({
    where: { organizationId, projectId, childKind: "ACCESSORY" },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      modelId: true,
      sortOrder: true,
      assetId: true,
      bulkAssetId: true,
      checkedOutQuantity: true,
      returnedQuantity: true,
      status: true,
      model: { select: { name: true, modelNumber: true } },
      units: { select: UNIT_SELECT },
    },
  });
}

/**
 * Read the bulk check-in totals for a project: every deployed accessory child
 * aggregated by identity. Read-only, org-scoped.
 */
export async function getBulkCheckInTotals(
  projectId: string,
): Promise<BulkCheckInTotal[]> {
  const { organizationId } = await getOrgContext();
  const children = await loadAccessoryChildren(organizationId, projectId);
  return serialize(aggregateAccessoryTotals(children.map(toInput)));
}

/**
 * Return accessories in aggregate. Each entry names a total (`key`) and how many
 * of that identity are physically in front of the operator. The requested count
 * is distributed deterministically across the underlying child line items.
 *
 * Safety:
 *  - **Authoritative outstanding.** Quantities are recomputed server-side from
 *    the live unit rows inside the transaction; the client number is never
 *    trusted.
 *  - **Over-return rejected.** If a requested quantity exceeds what is currently
 *    deployed for that identity, the whole batch throws and rolls back.
 *  - **Idempotent / empty-safe.** A zero (or omitted) quantity is skipped, an
 *    empty `returns` array is a clean no-op, and `returnLineUnits` clamps each
 *    child so a repeated submit can never drive a child below zero.
 */
export async function checkInBulkAccessoryTotals(
  projectId: string,
  returns: Array<{ key: string; quantity: number; condition?: ReturnCondition }>,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_in",
  );

  // Only act on entries that actually ask for something back.
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

    // Authoritative re-read inside the transaction.
    const children = (await tx.projectLineItem.findMany({
      where: { organizationId, projectId, childKind: "ACCESSORY" },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        modelId: true,
        sortOrder: true,
        assetId: true,
        bulkAssetId: true,
        checkedOutQuantity: true,
        returnedQuantity: true,
        status: true,
        model: { select: { name: true, modelNumber: true } },
        units: { select: UNIT_SELECT },
      },
    })) as AccessoryChildRow[];

    // Bucket children by aggregation key so a requested total maps to its lines.
    const byKey = new Map<string, AccessoryChildInput[]>();
    const labelByKey = new Map<string, string>();
    for (const child of children) {
      const input = toInput(child);
      const key = accessoryGroupKey(input);
      if (!key) continue;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(input);
      else byKey.set(key, [input]);
      if (!labelByKey.has(key)) labelByKey.set(key, input.modelName ?? "Accessory");
    }

    const summary: Array<{ key: string; quantity: number; condition: ReturnCondition }> = [];

    for (const req of wanted) {
      const condition: ReturnCondition = req.condition ?? "GOOD";
      const groupChildren = byKey.get(req.key) ?? [];
      const { allocations, distributed } = distributeReturn(groupChildren, req.quantity);

      // Over-return: asked for more than is currently deployed for this identity.
      if (distributed < req.quantity) {
        const available = groupChildren.reduce((s, c) => s + Math.max(0, c.outstanding), 0);
        throw new Error(
          `Cannot return ${req.quantity} of "${labelByKey.get(req.key) ?? req.key}" — only ${available} currently deployed.`,
        );
      }

      const assetsTouched: string[] = [];
      for (const alloc of allocations) {
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

      // Audit: per-asset scan logs for serialised returns, plus a group summary.
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
