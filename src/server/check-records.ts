"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { syncAssetsToConvex } from "@/lib/asset-mirror";
import { upsertProjectLineItemsToConvex } from "@/lib/line-item-mirror";
import { assertNoBlockingComments } from "@/lib/blocking-comments-read";
import { getModelMap, getModelById, type ConvexModel } from "@/lib/models-read";
import { getModelCheckItemCountMap } from "@/lib/line-item-tree-read";
import {
  prepUnit,
  syncLineItemRollup,
  returnLineUnits,
  checkinAccessoryChildren,
  resolveAssetAccessories,
} from "@/lib/line-item-fulfillment";
import type { Prisma } from "@/generated/prisma/client";
import {
  completeCheckAndPackSchema,
  type CompleteCheckAndPackValues,
  completeCheckAndFlagSchema,
  type CompleteCheckAndFlagValues,
  completeCheckAndStoreSchema,
  type CompleteCheckAndStoreValues,
  submitChecksSchema,
  type SubmitChecksFormValues,
  type CheckRecordFormValues,
} from "@/lib/validations/check-item";

// ─── Helpers ────────────────────────────────────────────────────────────────

// model lives in Convex (dual-written) — graft it onto line-item rows from the
// model map, replacing the `include: { model }` joins. Shape-identical flat doc;
// null-safe (the modelId FK is NOT NULL in Prisma, but a mirror miss → null).
async function attachLineItemModels<T extends { modelId: string | null }>(
  organizationId: string,
  rows: T[],
): Promise<Array<T & { model: ConvexModel | null }>> {
  const modelMap = await getModelMap(organizationId);
  return rows.map((r) => ({ ...r, model: r.modelId ? modelMap.get(r.modelId) ?? null : null }));
}

async function saveCheckRecords(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
  assetId: string,
  lineItemId: string | undefined | null,
  bulkAssetId: string | undefined | null,
  context: "PREP" | "RETURN" | "AD_HOC",
  checks: CheckRecordFormValues[],
  kitId?: string | null
) {
  // Fetch check item details for snapshots
  const checkItemIds = checks.map((c) => c.checkItemId);
  const checkItems = await tx.checkItem.findMany({
    where: { id: { in: checkItemIds }, organizationId },
    select: { id: true, label: true, type: true },
  });
  const checkItemMap = new Map(checkItems.map((ci) => [ci.id, ci]));

  const records = [];
  for (const check of checks) {
    const ci = checkItemMap.get(check.checkItemId);
    if (!ci) {
      throw new Error(`Check item ${check.checkItemId} not found`);
    }

    records.push(
      await tx.checkRecord.create({
        data: {
          organization: { connect: { id: organizationId } },
          context,
          checkItem: { connect: { id: check.checkItemId } },
          checkItemLabelSnapshot: ci.label,
          checkItemTypeSnapshot: ci.type,
          result: check.result,
          value: check.value || null,
          notes: check.notes || null,
          photos: check.photos || [],
          performedBy: { connect: { id: userId } },
          ...(lineItemId ? { lineItem: { connect: { id: lineItemId } } } : {}),
          ...(assetId ? { asset: { connect: { id: assetId } } } : {}),
          ...(bulkAssetId ? { bulkAsset: { connect: { id: bulkAssetId } } } : {}),
          ...(kitId ? { kit: { connect: { id: kitId } } } : {}),
        },
      })
    );
  }

  return records;
}

/** After saving FAIL records, check if predictive maintenance should trigger */
async function checkPredictiveMaintenance(
  organizationId: string,
  userId: string,
  userName: string,
  assetId: string,
  failedCheckItemIds: string[]
) {
  for (const checkItemId of failedCheckItemIds) {
    // Get last 3 check records for this asset + check item
    const recentRecords = await prisma.checkRecord.findMany({
      where: { organizationId, assetId, checkItemId },
      orderBy: { performedAt: "desc" },
      take: 3,
      select: { result: true },
    });

    const failCount = recentRecords.filter((r) => r.result === "FAIL").length;

    if (failCount >= 2) {
      // Get asset and check item details for the maintenance record
      const [asset, checkItem] = await Promise.all([
        prisma.asset.findUnique({
          where: { id: assetId },
          select: { assetTag: true, modelId: true },
        }),
        prisma.checkItem.findUnique({
          where: { id: checkItemId },
          select: { label: true },
        }),
      ]);

      if (!asset || !checkItem) continue;

      // model name lives in Convex — resolve for the maintenance description.
      const modelName = asset.modelId ? (await getModelById(asset.modelId))?.name ?? "" : "";

      // Check if a maintenance record already exists for this pattern (avoid duplicates)
      const existingMaintenance = await prisma.maintenanceRecord.findFirst({
        where: {
          organizationId,
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
          title: { contains: `[Auto] ${checkItem.label}` },
          assets: { some: { assetId } },
        },
      });

      if (!existingMaintenance) {
        const maintenance = await prisma.maintenanceRecord.create({
          data: {
            organizationId,
            type: "PREVENTATIVE",
            status: "SCHEDULED",
            title: `[Auto] ${checkItem.label} — ${asset.assetTag}`,
            description: `Automatically created: "${checkItem.label}" failed ${failCount} of last ${recentRecords.length} checks on ${modelName} (${asset.assetTag}).`,
            reportedById: userId,
            scheduledDate: new Date(),
          },
        });

        await prisma.maintenanceRecordAsset.create({
          data: {
            maintenanceRecordId: maintenance.id,
            assetId,
          },
        });

        await logActivity({
          organizationId,
          userId,
          userName,
          action: "CREATE",
          entityType: "maintenance",
          entityId: maintenance.id,
          entityName: maintenance.title,
          summary: `Auto-created maintenance for repeated check failure`,
          assetId,
        });
      }
    }
  }
}

// ─── Pull / Unpack (intermediate status before check form) ──────────────────

export async function pullItem(projectId: string, lineItemId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );

  const lineItem = await prisma.projectLineItem.findFirst({
    where: { id: lineItemId, projectId, organizationId },
  });

  if (!lineItem) {
    throw new Error("Line item not found in project");
  }

  await assertNoBlockingComments(organizationId, projectId, {
    lineItemId,
    actionLabel: "pull this item",
  });

  const result = await prisma.projectLineItem.update({
    where: { id: lineItemId },
    data: { prepStatus: "PULLED" },
    include: { asset: true, bulkAsset: true },
  });
  const [grafted] = await attachLineItemModels(organizationId, [result]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: lineItemId,
    entityName: grafted.model?.name || `Line item`,
    summary: `Pulled item for prep check`,
    projectId,
    assetId: lineItem.assetId || undefined,
  });

  await upsertProjectLineItemsToConvex(projectId);
  return serialize(grafted);
}

// ─── Prep item directly (no checks needed) ──────────────────────────────────
// Assigns the asset to the line item and sets prepStatus=PACKED without deploying.
// Used in the Pick/Prep flow for items that have no check items assigned.

/**
 * The permanent accessories a specific asset carries (battery kit, mic clip, …),
 * for the prep picker's per-accessory checkboxes. Each is keyed by its accessory
 * identity — serialised accessory `assetId` or bulk accessory `bulkAssetId` —
 * which is exactly what prep takes back in `includeAccessoryIds`.
 */
export async function getAssetAccessories(assetId: string) {
  const { organizationId } = await getOrgContext();
  const profile = await prisma.$transaction((tx) =>
    resolveAssetAccessories(tx, organizationId, assetId)
  );
  return serialize({
    serialised: profile.serialised.map((s) => ({
      id: s.assetId,
      name: s.modelName,
    })),
    bulk: profile.bulks.map((b) => ({
      id: b.bulkAssetId,
      name: b.modelName,
      quantity: b.quantity,
    })),
  });
}

export async function prepItemDirect(
  projectId: string,
  lineItemId: string,
  assetId?: string,
  quantity?: number,
  prepContainer?: string | null,
  /** Accessory identities (serialised assetId / bulk bulkAssetId) to pack with
   *  this unit. Undefined = all of the asset's accessories. The prep picker
   *  passes the ticked set so an operator can leave one off this handheld. */
  includeAccessoryIds?: string[]
) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );

  await assertNoBlockingComments(organizationId, projectId, {
    lineItemId,
    actionLabel: "prep this item",
  });

  const result = await prisma.$transaction(async (tx) => {
    const lineItem = await tx.projectLineItem.findFirst({
      where: { id: lineItemId, projectId, organizationId },
    });

    if (!lineItem) {
      throw new Error("Line item not found in project");
    }

    // Prep creates/marks a ProjectLineItemUnit — never splits the line.
    return prepUnit(tx, {
      organizationId,
      lineItemId,
      assetId: assetId ?? null,
      bulkAssetId: assetId ? null : lineItem.bulkAssetId,
      quantity,
      prepContainer,
      includeAccessoryIds: includeAccessoryIds ? new Set(includeAccessoryIds) : null,
    });
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: lineItemId,
    entityName: result.model?.name || "Line item",
    summary: "Prepped item (no checks required)",
    projectId,
    assetId: assetId || result.assetId || undefined,
  });

  await upsertProjectLineItemsToConvex(projectId);
  return serialize(result);
}

export async function deprepItem(
  projectId: string,
  lineItemId: string,
  quantity: number = 1
) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );

  const result = await prisma.$transaction(async (tx) => {
    const lineItem = await tx.projectLineItem.findFirst({
      where: { id: lineItemId, projectId, organizationId },
      include: { asset: true, bulkAsset: true },
    });

    if (!lineItem) {
      throw new Error("Line item not found in project");
    }

    // Allow deprep from any non-deployed state (handles PACKED, PULLED, or inconsistent states)
    if (lineItem.status === "CHECKED_OUT") {
      throw new Error("Item is already deployed — return it first");
    }

    // Forward deprep of a RETURNED line (Returned → Depreped): the units carry
    // the return record (returnedQuantity, condition). NEVER delete them — that
    // would roll returnedQuantity back to 0 and revert the line to CONFIRMED,
    // making returned gear reappear in Pick/Prep as if it never shipped (the
    // exact bug the linear-flow rework kills). Instead, just clear their stale
    // PACKED prepStatus so the rollup keeps the line in Depreped instead of
    // promoting it back to PACKED/Returned.
    if (lineItem.status === "RETURNED") {
      await tx.projectLineItemUnit.updateMany({
        where: { lineItemId, status: "RETURNED", prepStatus: "PACKED" },
        data: { prepStatus: "PENDING" },
      });
    }

    // Backward deprep of a not-yet-shipped line ("packed by mistake"): remove the
    // prep unit rows or the asset stays "stuck" on the line — visible in the
    // project view, on dockets, and blocking the asset from being reassigned.
    // RETURNED units are excluded (handled above) so a return record is never
    // destroyed even if this path runs on a returned line.
    //
    // asset.status is left alone — prep never marked it CHECKED_OUT,
    // so it's still AVAILABLE. The unit row carries the assignment;
    // deleting the unit removes the assignment.
    const preppedUnits = await tx.projectLineItemUnit.findMany({
      where: {
        lineItemId,
        status: { notIn: ["CHECKED_OUT", "RETURNED"] },
      },
      orderBy: { ordinal: "desc" },
      select: { id: true, quantity: true, bulkAssetId: true, assetId: true },
    });

    // Partial bulk deprep: a single bulk unit row carries the qty —
    // reduce its quantity instead of deleting the whole row.
    const isPartialBulk =
      preppedUnits.length === 1 &&
      preppedUnits[0].bulkAssetId &&
      !preppedUnits[0].assetId &&
      quantity < preppedUnits[0].quantity;
    if (isPartialBulk) {
      await tx.projectLineItemUnit.update({
        where: { id: preppedUnits[0].id },
        data: { quantity: preppedUnits[0].quantity - quantity },
      });
    } else {
      // Serialised deprep — remove `quantity` units, highest-ordinal
      // first (preserves the lower ordinals for staff who already
      // pulled them physically; also natural LIFO).
      const removeCount = Math.min(quantity, preppedUnits.length);
      const removedParentAssetIds: string[] = [];
      for (let i = 0; i < removeCount; i++) {
        if (preppedUnits[i].assetId) removedParentAssetIds.push(preppedUnits[i].assetId as string);
        await tx.projectLineItemUnit.delete({
          where: { id: preppedUnits[i].id },
        });
      }
      // Cascade: the accessory units that rode with each removed handheld
      // (parentUnitAssetId) come off too — else a battery/clip unit lingers on
      // the deploy board with no parent. Mirrors how prep materialised them.
      if (removedParentAssetIds.length > 0) {
        const accChildren = await tx.projectLineItem.findMany({
          where: { parentLineItemId: lineItemId, organizationId, childKind: "ACCESSORY" },
          select: { id: true },
        });
        if (accChildren.length > 0) {
          const accChildIds = accChildren.map((c) => c.id);
          await tx.projectLineItemUnit.deleteMany({
            where: {
              lineItemId: { in: accChildIds },
              organizationId,
              parentUnitAssetId: { in: removedParentAssetIds },
              status: { not: "CHECKED_OUT" },
            },
          });
          for (const id of accChildIds) await syncLineItemRollup(tx, id);
        }
      }
    }

    // Clear legacy line.assetId (kit children excepted — they store
    // their asset there as an active path, not as a fulfillment row).
    if (!lineItem.isKitChild && lineItem.assetId) {
      await tx.projectLineItem.update({
        where: { id: lineItemId },
        data: { asset: { disconnect: true } },
      });
    }

    // Recompute rollup. With units gone, deriveOrderLinePrepStatus
    // falls back to whatever was on the line — explicitly reset to
    // PENDING here so the line returns to the prep tab.
    await tx.projectLineItem.update({
      where: { id: lineItemId },
      data: { prepStatus: "PENDING" },
    });
    await syncLineItemRollup(tx, lineItemId);

    return tx.projectLineItem.findUniqueOrThrow({
      where: { id: lineItemId },
      include: { asset: true, bulkAsset: true },
    });
  });
  const [grafted] = await attachLineItemModels(organizationId, [result]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: lineItemId,
    entityName: grafted.model?.name || "Line item",
    summary: "Removed item from prep",
    projectId,
    assetId: result.assetId || undefined,
  });

  await upsertProjectLineItemsToConvex(projectId);
  return serialize(grafted);
}

/**
 * Write RETURN-context check records for an already-returned item and deprep it
 * (reset prepStatus=PENDING, removing it from the deploy staging area).
 *
 * Used by the deploy tab's deprep action when staff are putting returned items back
 * into inventory — the "post-truck" half of the check symmetry. The item is already
 * in status=RETURNED (the return-tab scan handled that); this call just records an
 * additional set of checks at the moment the item physically re-enters inventory,
 * then transitions prepStatus back to PENDING.
 *
 * Pre-condition: line item must have status=RETURNED. Items that never shipped
 * (status=CONFIRMED) should use the plain deprepItem() path — no return check applies.
 */
export async function completeCheckAndDeprep(data: {
  projectId: string;
  lineItemId: string;
  assetId?: string;
  bulkAssetId?: string | null;
  checks: CheckRecordFormValues[];
}) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );

  const result = await prisma.$transaction(async (tx) => {
    const lineItem = await tx.projectLineItem.findFirst({
      where: { id: data.lineItemId, projectId: data.projectId, organizationId },
      include: { asset: true, bulkAsset: true },
    });

    if (!lineItem) {
      throw new Error("Line item not found in project");
    }
    if (lineItem.status !== "RETURNED") {
      throw new Error(
        `Deprep return check requires RETURNED status (got ${lineItem.status})`
      );
    }
    // Idempotent on prepStatus. A multi-unit line generates N sequential
    // completeCheckAndDeprep calls — the first resets prepStatus from
    // PACKED to PENDING, and the remaining calls would have failed a
    // strict PACKED-only precondition. We still want each call to save
    // its check records (one per asset), and resetting prepStatus to
    // PENDING is idempotent. Only reject states that indicate the line
    // never went through prep at all (eg FLAGGED_FAULTY).
    if (
      lineItem.prepStatus !== "PACKED" &&
      lineItem.prepStatus !== "PENDING"
    ) {
      throw new Error(
        `Deprep return check expected prepStatus=PACKED or PENDING (got ${lineItem.prepStatus ?? "null"})`
      );
    }

    // Write RETURN-context check records.
    // assetId may be empty if the return-tab scan already disconnected it — that's OK,
    // saveCheckRecords skips the asset connect when assetId is falsy.
    const resolvedAssetId = data.assetId || lineItem.assetId || "";
    await saveCheckRecords(
      tx,
      organizationId,
      userId,
      resolvedAssetId,
      data.lineItemId,
      data.bulkAssetId || lineItem.bulkAssetId,
      "RETURN",
      data.checks
    );

    // Reset prepStatus to remove from deploy staging. Do not touch status/returnStatus —
    // the return-tab flow already set those.
    const updated = await tx.projectLineItem.update({
      where: { id: data.lineItemId },
      data: {
        prepStatus: "PENDING",
        ...(!lineItem.isKitChild && lineItem.assetId
          ? { asset: { disconnect: true } }
          : {}),
      },
      include: { asset: true, bulkAsset: true },
    });

    // Clear the parent line's own RETURNED units' stale PACKED prepStatus. The
    // line update above set line.prepStatus=PENDING, but if the returned units
    // keep prepStatus=PACKED a later syncLineItemRollup would derive the line
    // back to PACKED (deriveOrderLinePrepStatus) and bounce it from Depreped
    // back into Returned. Scope to the returned asset when known.
    await tx.projectLineItemUnit.updateMany({
      where: {
        lineItemId: data.lineItemId,
        organizationId,
        status: "RETURNED",
        prepStatus: "PACKED",
        ...(resolvedAssetId ? { assetId: resolvedAssetId } : {}),
      },
      data: { prepStatus: "PENDING" },
    });

    // Permanent accessories de-prep with their parent so they don't linger in
    // the deploy-staging board. Scoped to the returned unit (resolvedAssetId):
    // its serialised accessories (asset.parentAssetId match) plus the shared
    // bulk accessory rows. A whole-line deprep (no assetId) clears them all.
    await tx.projectLineItem.updateMany({
      where: {
        parentLineItemId: data.lineItemId,
        organizationId,
        childKind: "ACCESSORY",
        ...(resolvedAssetId
          ? { OR: [{ asset: { parentAssetId: resolvedAssetId } }, { assetId: null }] }
          : {}),
      },
      data: { prepStatus: "PENDING" },
    });
    // Clear the per-parent-unit accessory units' stale PACKED prepStatus too
    // (scoped to the returned handheld), so the line's derived prep state and
    // the deploy-staging board don't show them as still packed.
    await tx.projectLineItemUnit.updateMany({
      where: {
        organizationId,
        lineItem: { parentLineItemId: data.lineItemId, childKind: "ACCESSORY" },
        ...(resolvedAssetId ? { parentUnitAssetId: resolvedAssetId } : {}),
      },
      data: { prepStatus: "PENDING" },
    });

    return updated;
  });
  const [grafted] = await attachLineItemModels(organizationId, [result]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: data.lineItemId,
    entityName: grafted.model?.name || "Line item",
    summary: "Deprep return check complete — item returned to inventory",
    projectId: data.projectId,
    assetId: result.assetId || undefined,
  });

  await upsertProjectLineItemsToConvex(data.projectId);
  return serialize(grafted);
}

/**
 * Reverse prep for a kit: set parent + all children/grandchildren back to PENDING.
 */
export async function deprepKit(
  projectId: string,
  parentLineItemId: string
) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );

  const parentLi = await prisma.projectLineItem.findFirst({
    where: { id: parentLineItemId, projectId, organizationId },
    include: {
      childLineItems: {
        include: {
          childLineItems: true,
        },
      },
      kit: true,
    },
  });

  if (!parentLi) throw new Error("Kit line item not found");

  // Allow deprep if the kit or any children are in a prepped state
  // (handles edge cases where parent/children are out of sync)
  if (parentLi.prepStatus !== "PACKED" && parentLi.prepStatus !== "PULLED") {
    // Check if any children are prepped even if parent isn't
    const hasPreppedChildren = (parentLi.childLineItems || []).some(
      (c) => c.prepStatus === "PACKED" || c.prepStatus === "PULLED"
    );
    if (!hasPreppedChildren) {
      throw new Error("Kit is not prepped");
    }
  }

  await prisma.$transaction(async (tx) => {
    const children = parentLi.childLineItems || [];
    for (const child of children) {
      if (child.status === "CHECKED_OUT" || child.status === "CANCELLED") continue;

      await tx.projectLineItem.update({
        where: { id: child.id },
        data: { prepStatus: "PENDING" },
      });

      const grandchildren = child.childLineItems || [];
      for (const gc of grandchildren) {
        if (gc.status === "CHECKED_OUT" || gc.status === "CANCELLED") continue;
        await tx.projectLineItem.update({
          where: { id: gc.id },
          data: { prepStatus: "PENDING" },
        });
      }
    }

    await tx.projectLineItem.update({
      where: { id: parentLineItemId },
      data: { prepStatus: "PENDING" },
    });
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: parentLineItemId,
    entityName: parentLi.kit?.name || "Kit",
    summary: "Removed kit from prep",
    projectId,
  });

  await upsertProjectLineItemsToConvex(projectId);
  return serialize({ success: true });
}

/**
 * Mark all children of a kit line item as prepped (prepStatus=PACKED).
 * Called after kit check forms are completed in PREP context.
 */
export async function prepKitChildren(
  projectId: string,
  parentLineItemId: string
) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );

  const parentLi = await prisma.projectLineItem.findFirst({
    where: { id: parentLineItemId, projectId, organizationId },
    include: {
      childLineItems: {
        include: {
          childLineItems: true, // nested kit grandchildren
        },
      },
      kit: true,
    },
  });

  if (!parentLi) throw new Error("Kit line item not found");

  await assertNoBlockingComments(organizationId, projectId, {
    lineItemId: parentLineItemId,
    actionLabel: "prep this kit",
  });

  await prisma.$transaction(async (tx) => {
    const children = parentLi.childLineItems || [];
    for (const child of children) {
      if (child.status === "CHECKED_OUT" || child.status === "CANCELLED") continue;

      // Mark child as prepped (reset status in case of re-prep after return)
      await tx.projectLineItem.update({
        where: { id: child.id },
        data: { status: "CONFIRMED", prepStatus: "PACKED" },
      });

      // If child is a nested kit, also mark its grandchildren
      const grandchildren = child.childLineItems || [];
      for (const gc of grandchildren) {
        if (gc.status === "CHECKED_OUT" || gc.status === "CANCELLED") continue;
        await tx.projectLineItem.update({
          where: { id: gc.id },
          data: { status: "CONFIRMED", prepStatus: "PACKED" },
        });
      }
    }

    // Mark the parent kit line item as prepped too
    await tx.projectLineItem.update({
      where: { id: parentLineItemId },
      data: { status: "CONFIRMED", prepStatus: "PACKED" },
    });
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: parentLineItemId,
    entityName: parentLi.kit?.name || "Kit",
    summary: "Kit prepped (checks completed)",
    projectId,
  });

  await upsertProjectLineItemsToConvex(projectId);
  return serialize({ success: true });
}

export async function unpackItem(projectId: string, lineItemId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_in"
  );

  const lineItem = await prisma.projectLineItem.findFirst({
    where: { id: lineItemId, projectId, organizationId },
  });

  if (!lineItem) {
    throw new Error("Line item not found in project");
  }

  const result = await prisma.projectLineItem.update({
    where: { id: lineItemId },
    data: { returnStatus: "UNPACKED" },
    include: { asset: true, bulkAsset: true },
  });
  const [grafted] = await attachLineItemModels(organizationId, [result]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: lineItemId,
    entityName: grafted.model?.name || `Line item`,
    summary: `Unpacked item for return check`,
    projectId,
    assetId: lineItem.assetId || undefined,
  });

  await upsertProjectLineItemsToConvex(projectId);
  return serialize(grafted);
}

// ─── Composite: Check + Prep (prep flow — saves checks + sets PACKED, no deploy) ─

export async function completeCheckAndPack(data: CompleteCheckAndPackValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );
  const parsed = completeCheckAndPackSchema.parse(data);

  await assertNoBlockingComments(organizationId, parsed.projectId, {
    lineItemId: parsed.lineItemId,
    actionLabel: "complete the check & pack",
  });

  const result = await prisma.$transaction(async (tx) => {
    // 1. Verify line item
    const lineItem = await tx.projectLineItem.findFirst({
      where: {
        id: parsed.lineItemId,
        projectId: parsed.projectId,
        organizationId,
      },
    });

    if (!lineItem) {
      throw new Error("Line item not found in project");
    }

    // Resolve assetId: prefer parsed value, fall back to line item's asset
    const resolvedAssetId = parsed.assetId || lineItem.assetId || "";

    // 2. Save check records
    await saveCheckRecords(
      tx,
      organizationId,
      userId,
      resolvedAssetId,
      parsed.lineItemId,
      parsed.bulkAssetId || lineItem.bulkAssetId,
      "PREP",
      parsed.checks
    );

    // 3. Prep — create/mark the unit (no checkout; deploy is a separate step).
    const updatedItem = await prepUnit(tx, {
      organizationId,
      lineItemId: parsed.lineItemId,
      assetId: parsed.assetId ?? null,
      bulkAssetId: parsed.assetId ? null : lineItem.bulkAssetId,
      prepContainer: parsed.prepContainer,
      includeAccessoryIds: parsed.includeAccessoryIds ? new Set(parsed.includeAccessoryIds) : null,
    });

    return { updatedItem, resolvedAssetId };
  });

  // Post-commit: predictive maintenance check
  const failedChecks = parsed.checks.filter((c) => c.result === "FAIL");
  if (failedChecks.length > 0) {
    await checkPredictiveMaintenance(
      organizationId,
      userId,
      userName,
      result.resolvedAssetId,
      failedChecks.map((c) => c.checkItemId)
    ).catch(console.error);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: result.resolvedAssetId || parsed.lineItemId,
    entityName: `Line item ${parsed.lineItemId}`,
    summary: `Completed checks and prepped item`,
    projectId: parsed.projectId,
    assetId: result.resolvedAssetId || undefined,
  });

  await upsertProjectLineItemsToConvex(parsed.projectId);
  return serialize(result.updatedItem);
}

// ─── Composite: Check + Flag (prep flow — faulty/TT overdue) ───────────────

export async function completeCheckAndFlag(data: CompleteCheckAndFlagValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );
  const parsed = completeCheckAndFlagSchema.parse(data);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Resolve assetId from line item if not provided
    const lineItem = await tx.projectLineItem.findFirst({
      where: { id: parsed.lineItemId, projectId: parsed.projectId, organizationId },
    });
    if (!lineItem) throw new Error("Line item not found in project");
    const resolvedAssetId = parsed.assetId || lineItem.assetId || "";

    // 2. Save check records
    await saveCheckRecords(
      tx,
      organizationId,
      userId,
      resolvedAssetId,
      parsed.lineItemId,
      parsed.bulkAssetId || lineItem.bulkAssetId,
      "PREP",
      parsed.checks
    );

    // 3. Update line item to flagged status
    const updatedItem = await tx.projectLineItem.update({
      where: { id: parsed.lineItemId },
      data: {
        prepStatus: parsed.flagType,
      },
      include: { asset: true, bulkAsset: true },
    });

    return { updatedItem, resolvedAssetId };
  });

  // Post-commit: predictive maintenance
  const failedChecks = parsed.checks.filter((c) => c.result === "FAIL");
  if (failedChecks.length > 0) {
    await checkPredictiveMaintenance(
      organizationId,
      userId,
      userName,
      result.resolvedAssetId,
      failedChecks.map((c) => c.checkItemId)
    ).catch(console.error);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: result.resolvedAssetId || parsed.lineItemId,
    entityName: `Line item ${parsed.lineItemId}`,
    summary: `Flagged item as ${parsed.flagType === "FLAGGED_FAULTY" ? "faulty" : "T&T overdue"}`,
    projectId: parsed.projectId,
    assetId: result.resolvedAssetId || undefined,
  });

  await upsertProjectLineItemsToConvex(parsed.projectId);
  return serialize(result.updatedItem);
}

// ─── Composite: Check + Store (return flow) ─────────────────────────────────

export async function completeCheckAndStore(
  data: CompleteCheckAndStoreValues
) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_in"
  );
  const parsed = completeCheckAndStoreSchema.parse(data);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Verify line item (needed to resolve assetId)
    const lineItem = await tx.projectLineItem.findFirst({
      where: {
        id: parsed.lineItemId,
        projectId: parsed.projectId,
        organizationId,
      },
    });

    if (!lineItem) {
      throw new Error("Line item not found in project");
    }

    // Resolve assetId: prefer parsed value, fall back to line item's asset
    const resolvedAssetId = parsed.assetId || lineItem.assetId || "";

    // 2. Save check records
    await saveCheckRecords(
      tx,
      organizationId,
      userId,
      resolvedAssetId,
      parsed.lineItemId,
      parsed.bulkAssetId || lineItem.bulkAssetId,
      "RETURN",
      parsed.checks
    );

    // 3. Determine return location
    let locationId = parsed.locationId || null;
    if (!locationId) {
      const defaultLocation = await tx.location.findFirst({
        where: { organizationId, isDefault: true },
        select: { id: true },
      });
      locationId = defaultLocation?.id || null;
    }

    // 4. Perform the actual return via the canonical helper — same
    //    code path checkInItems uses, so a multi-unit line's units
    //    and assets all get flipped, not just the order-line counter.
    //    Pre-cutover this function hand-rolled the checkin, which
    //    only touched `line.returnedQuantity` and left units / assets
    //    stuck in CHECKED_OUT — the root cause of "return didn't
    //    release the assets" on multi-quantity serialised lines.
    const { unitsFlipped, assetsTouched } = await returnLineUnits(tx, {
      organizationId,
      projectId: parsed.projectId,
      lineItemId: parsed.lineItemId,
      assetId: parsed.assetId,
      bulkAssetId: parsed.bulkAssetId,
      returnCondition: parsed.condition,
      quantity: 1,
      notes: parsed.notes,
      userId,
      defaultLocationId: locationId,
    });

    // 5. Sync rollup counters + derived status.
    await syncLineItemRollup(tx, parsed.lineItemId);

    // 5b. Permanent accessories return with their parent — the same cascade
    //     checkInItems runs, scoped to the returned unit (resolvedAssetId) so a
    //     multi-quantity parent doesn't return its siblings' accessories. Only
    //     when the parent return flipped a unit, so a re-check-and-store of an
    //     already-returned unit can't re-return the shared bulk accessory.
    //     No-op for non-parent lines.
    const touchedAssets = [...assetsTouched];
    if (unitsFlipped > 0) {
      const acc = await checkinAccessoryChildren(tx, {
        organizationId,
        projectId: parsed.projectId,
        parentLineItemId: parsed.lineItemId,
        returnCondition: parsed.condition,
        userId,
        defaultLocationId: locationId,
        returnedAssetId: resolvedAssetId || null,
      });
      touchedAssets.push(...acc.assetsTouched);
    }

    // 6. Scan log
    await tx.assetScanLog.create({
      data: {
        organizationId,
        assetId: assetsTouched.length === 1 ? assetsTouched[0] : null,
        bulkAssetId: lineItem.bulkAssetId || null,
        projectId: parsed.projectId,
        action: "CHECK_IN",
        scannedById: userId,
        notes:
          parsed.notes ||
          `Checked + returned ${unitsFlipped || assetsTouched.length} unit(s)`,
      },
    });

    const updatedItem = await tx.projectLineItem.findUnique({
      where: { id: parsed.lineItemId },
      include: { asset: true, bulkAsset: true },
    });

    return { updatedItem, resolvedAssetId, touchedAssets };
  });

  // Mirror the returned asset(s) status/location changes to Convex.
  await syncAssetsToConvex(result.touchedAssets);

  // Post-commit: predictive maintenance
  const failedChecks = parsed.checks.filter((c) => c.result === "FAIL");
  if (failedChecks.length > 0) {
    await checkPredictiveMaintenance(
      organizationId,
      userId,
      userName,
      result.resolvedAssetId,
      failedChecks.map((c) => c.checkItemId)
    ).catch(console.error);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CHECK_IN",
    entityType: "asset",
    entityId: result.resolvedAssetId || parsed.lineItemId,
    entityName: `Line item ${parsed.lineItemId}`,
    summary: `Completed check and stored item (condition: ${parsed.condition})`,
    projectId: parsed.projectId,
    assetId: result.resolvedAssetId || undefined,
  });

  await upsertProjectLineItemsToConvex(parsed.projectId);
  return serialize(result.updatedItem);
}

// ─── Ad-Hoc Check ───────────────────────────────────────────────────────────

export async function saveAdHocCheck(data: SubmitChecksFormValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "scan"
  );
  const parsed = submitChecksSchema.parse(data);

  if (parsed.context !== "AD_HOC") {
    throw new Error("This function is for ad-hoc checks only");
  }

  const records = await prisma.$transaction(async (tx) => {
    return saveCheckRecords(
      tx,
      organizationId,
      userId,
      parsed.assetId,
      null,
      parsed.bulkAssetId,
      "AD_HOC",
      parsed.checks
    );
  });

  // Post-commit: predictive maintenance
  const failedChecks = parsed.checks.filter((c) => c.result === "FAIL");
  if (failedChecks.length > 0) {
    await checkPredictiveMaintenance(
      organizationId,
      userId,
      userName,
      parsed.assetId,
      failedChecks.map((c) => c.checkItemId)
    ).catch(console.error);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "checkRecord",
    entityId: records[0]?.id || parsed.assetId,
    entityName: `Ad-hoc check on asset`,
    summary: `Performed ad-hoc check (${parsed.checks.length} items)`,
    assetId: parsed.assetId,
  });

  return serialize(records);
}

// ─── Asset Lookup for Ad-Hoc Checks ─────────────────────────────────────────

export async function lookupAssetForAdHocCheck(assetTag: string) {
  const { organizationId } = await getOrgContext();

  const asset = await prisma.asset.findUnique({
    where: { organizationId_assetTag: { organizationId, assetTag } },
  });

  if (!asset) {
    return serialize({ found: false as const, asset: null });
  }

  // model name + check-item count live in Convex (dual-written) — resolve from
  // the model map + the model-check-item count map, not a Prisma join/_count.
  const [model, checkCounts] = await Promise.all([
    getModelById(asset.modelId),
    getModelCheckItemCountMap(organizationId),
  ]);

  return serialize({
    found: true as const,
    asset: {
      id: asset.id,
      assetTag: asset.assetTag,
      serialNumber: asset.serialNumber,
      modelId: asset.modelId,
      modelName: model?.name ?? "",
      checkItemCount: checkCounts.get(asset.modelId) ?? 0,
    },
  });
}

// ─── Check History & Analytics ──────────────────────────────────────────────

export async function getCheckHistory(assetId: string, context?: string) {
  const { organizationId } = await getOrgContext();

  return serialize(
    await prisma.checkRecord.findMany({
      where: {
        organizationId,
        assetId,
        ...(context && { context: context as "PREP" | "RETURN" | "AD_HOC" }),
      },
      include: {
        checkItem: { select: { label: true, type: true, category: true } },
        performedBy: { select: { name: true } },
        lineItem: {
          select: {
            project: { select: { id: true, name: true, projectNumber: true } },
          },
        },
      },
      orderBy: { performedAt: "desc" },
    })
  );
}

export async function getModelFailureAnalytics(modelId: string) {
  const { organizationId } = await getOrgContext();

  // Get all check items assigned to this model
  const modelCheckItems = await prisma.modelCheckItem.findMany({
    where: { modelId, organizationId },
    include: { checkItem: { select: { id: true, label: true, type: true } } },
    orderBy: { sortOrder: "asc" },
  });

  // Get all assets of this model
  const assets = await prisma.asset.findMany({
    where: { modelId, organizationId },
    select: { id: true },
  });
  const assetIds = assets.map((a) => a.id);

  if (assetIds.length === 0 || modelCheckItems.length === 0) {
    return serialize([]);
  }

  // Get aggregate counts per check item
  const analytics = await Promise.all(
    modelCheckItems.map(async (mci) => {
      const [totalCount, failCount] = await Promise.all([
        prisma.checkRecord.count({
          where: {
            organizationId,
            checkItemId: mci.checkItemId,
            assetId: { in: assetIds },
            result: { in: ["PASS", "FAIL"] },
          },
        }),
        prisma.checkRecord.count({
          where: {
            organizationId,
            checkItemId: mci.checkItemId,
            assetId: { in: assetIds },
            result: "FAIL",
          },
        }),
      ]);

      return {
        checkItemId: mci.checkItemId,
        label: mci.checkItem.label,
        type: mci.checkItem.type,
        totalChecks: totalCount,
        failCount,
        failRate: totalCount > 0 ? failCount / totalCount : 0,
      };
    })
  );

  return serialize(analytics);
}

// ─── Kit Check Actions ──────────────────────────────────────────────────────

/**
 * Save check records for a kit-level check (KIT_LEVEL mode).
 * Does NOT perform checkout/checkin — the caller handles that separately.
 */
export async function saveKitLevelChecks(
  projectId: string,
  kitId: string,
  lineItemId: string,
  context: "PREP" | "RETURN",
  checks: CheckRecordFormValues[]
) {
  const { organizationId, userId } = await requirePermission(
    "warehouse",
    context === "PREP" ? "check_out" : "check_in"
  );

  await prisma.$transaction(async (tx) => {
    await saveCheckRecords(
      tx,
      organizationId,
      userId,
      "", // no specific asset for kit-level
      lineItemId,
      null,
      context,
      checks,
      kitId
    );
  });

  return serialize({ success: true });
}

/**
 * Save check records for a single child item (PER_ITEM mode).
 * Does NOT perform checkout/checkin — the caller handles that via checkOutKit/checkInKit.
 */
export async function saveChildItemChecks(
  projectId: string,
  lineItemId: string,
  assetId: string | undefined,
  bulkAssetId: string | undefined,
  context: "PREP" | "RETURN",
  checks: CheckRecordFormValues[]
) {
  const { organizationId, userId } = await requirePermission(
    "warehouse",
    context === "PREP" ? "check_out" : "check_in"
  );

  let resolvedAssetId = "";

  await prisma.$transaction(async (tx) => {
    // Verify line item exists
    const lineItem = await tx.projectLineItem.findFirst({
      where: { id: lineItemId, organizationId },
    });
    if (!lineItem) throw new Error("Line item not found");

    resolvedAssetId = assetId || lineItem.assetId || "";

    await saveCheckRecords(
      tx,
      organizationId,
      userId,
      resolvedAssetId,
      lineItemId,
      bulkAssetId || lineItem.bulkAssetId,
      context,
      checks
    );
  });

  // Post-commit: predictive maintenance (uses prisma, not tx — must run after commit)
  if (resolvedAssetId) {
    const failedCheckItemIds = checks
      .filter((c) => c.result === "FAIL")
      .map((c) => c.checkItemId);
    if (failedCheckItemIds.length > 0) {
      const { userName } = await requirePermission("warehouse", context === "PREP" ? "check_out" : "check_in");
      await checkPredictiveMaintenance(
        organizationId,
        userId,
        userName,
        resolvedAssetId,
        failedCheckItemIds
      ).catch(console.error);
    }
  }

  return serialize({ success: true });
}
