"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { assertNoBlockingComments } from "@/lib/blocking-comments-read";
import { getModelMap, getModelById, type ConvexModel } from "@/lib/models-read";
import { getAssetById, getAssetByAssetTag, getBulkAssetById } from "@/lib/assets-read";
import {
  getCheckHistoryRows,
  getModelFailureAnalyticsRows,
} from "@/lib/check-record-read";
import { getModelCheckItemCountMap } from "@/lib/line-item-tree-read";
import { getMaintenanceRecordsByOrg } from "@/lib/maintenance-read";
import { getCheckItemById } from "@/lib/check-items-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import {
  getMaintenanceAssetLinksByAssetIds,
  createMaintenanceAssetLinks,
} from "@/lib/maintenance-record-asset-read";
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

// Convex-ready check record shape (Phase B inversion: no Prisma write).
type CheckRecordDoc = {
  id: string;
  organizationId: string;
  context: "PREP" | "RETURN" | "AD_HOC";
  lineItemId?: string;
  assetId?: string;
  bulkAssetId?: string;
  kitId?: string;
  checkItemId: string;
  checkItemLabelSnapshot: string;
  checkItemTypeSnapshot: string;
  result: string;
  value?: string;
  notes?: string;
  photos?: string[];
  performedById: string;
  performedAt: number;
};

async function saveCheckRecords(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
  assetId: string,
  lineItemId: string | undefined | null,
  bulkAssetId: string | undefined | null,
  context: "PREP" | "RETURN" | "AD_HOC",
  checks: CheckRecordFormValues[],
  kitId?: string | null,
  // Optional sink: Convex-ready docs are pushed here for post-tx write
  sink?: CheckRecordDoc[]
) {
  // Fetch check item details for snapshots (check_item stays Prisma)
  const checkItemIds = checks.map((c) => c.checkItemId);
  const checkItems = await tx.checkItem.findMany({
    where: { id: { in: checkItemIds }, organizationId },
    select: { id: true, label: true, type: true },
  });
  const checkItemMap = new Map(checkItems.map((ci) => [ci.id, ci]));

  const records: CheckRecordDoc[] = [];
  const now = Date.now();
  for (const check of checks) {
    const ci = checkItemMap.get(check.checkItemId);
    if (!ci) {
      throw new Error(`Check item ${check.checkItemId} not found`);
    }

    const doc: CheckRecordDoc = {
      id: createId(),
      organizationId,
      context,
      checkItemId: check.checkItemId,
      checkItemLabelSnapshot: ci.label,
      checkItemTypeSnapshot: ci.type,
      result: check.result,
      ...(check.value ? { value: check.value } : {}),
      ...(check.notes ? { notes: check.notes } : {}),
      ...(check.photos?.length ? { photos: check.photos } : {}),
      performedById: userId,
      performedAt: now,
      ...(lineItemId ? { lineItemId } : {}),
      ...(assetId ? { assetId } : {}),
      ...(bulkAssetId ? { bulkAssetId } : {}),
      ...(kitId ? { kitId } : {}),
    };
    records.push(doc);
    sink?.push(doc);
  }

  return records;
}

/** Write Phase-B check records to Convex after the Prisma tx commits. */
async function writeCheckRecordsToConvex(records: CheckRecordDoc[]) {
  const convex = await getConvexClient();
  for (const r of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await convex.mutation(api.checkRecords.createIfMissing, r as any);
  }
}

/** After saving FAIL records, check if predictive maintenance should trigger */
async function checkPredictiveMaintenance(
  organizationId: string,
  userId: string,
  userName: string,
  assetId: string,
  failedCheckItemIds: string[]
) {
  const convexForPM = await getConvexClient();
  for (const checkItemId of failedCheckItemIds) {
    // Get last 3 check records for this asset + check item from Convex (Phase B)
    const recentRecords = await convexForPM.query(api.checkRecords.listRecentByAssetAndCheckItem, {
      orgId: organizationId,
      assetId,
      checkItemId,
      take: 3,
    });

    const failCount = recentRecords.filter((r) => r.result === "FAIL").length;

    if (failCount >= 2) {
      // Get asset and check item details for the maintenance record
      const [asset, checkItem] = await Promise.all([
        getAssetById(assetId),
        // check_item is Convex-only — read the org-scoped row (label only used).
        getCheckItemById(organizationId, checkItemId),
      ]);

      if (!asset || !checkItem) continue;

      // model name lives in Convex — resolve for the maintenance description.
      const modelName = asset.modelId ? (await getModelById(asset.modelId))?.name ?? "" : "";

      // Check if a maintenance record already exists for this pattern (avoid
      // duplicates). The record scalars (org/status/title) come from the Convex
      // maintenance records; the `assets: { some: { assetId } }` join filter is
      // resolved from the Convex-only maintenanceRecordAsset join (Phase B).
      const titleNeedle = `[Auto] ${checkItem.label}`;
      const [orgRecords, assetLinks] = await Promise.all([
        getMaintenanceRecordsByOrg(organizationId),
        getMaintenanceAssetLinksByAssetIds([assetId]),
      ]);
      const recordIdsForAsset = new Set(assetLinks.map((l) => l.maintenanceRecordId));
      const existingMaintenance = orgRecords.find(
        (m) =>
          (m.status === "SCHEDULED" || m.status === "IN_PROGRESS") &&
          m.title.includes(titleNeedle) &&
          recordIdsForAsset.has(m.id),
      );

      if (!existingMaintenance) {
        const maintenanceId = createId();
        const maintenanceTitle = `[Auto] ${checkItem.label} — ${asset.assetTag}`;
        const now = Date.now();
        const convex = await getConvexClient();
        await convex.mutation(api.maintenanceRecords.createIfMissing, {
          id: maintenanceId,
          organizationId,
          type: "PREVENTATIVE",
          status: "SCHEDULED",
          title: maintenanceTitle,
          description: `Automatically created: "${checkItem.label}" failed ${failCount} of last ${recentRecords.length} checks on ${modelName} (${asset.assetTag}).`,
          reportedById: userId,
          scheduledDate: now,
          createdAt: now,
          updatedAt: now,
        });
        await createMaintenanceAssetLinks(maintenanceId, [assetId]);

        await logActivity({
          organizationId,
          userId,
          userName,
          action: "CREATE",
          entityType: "maintenance",
          entityId: maintenanceId,
          entityName: maintenanceTitle,
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

  const convex = await getConvexClient();
  const lineItem = await convex.query(api.projectLineItems.getById, { id: lineItemId });

  if (!lineItem || lineItem.projectId !== projectId || lineItem.organizationId !== organizationId) {
    throw new Error("Line item not found in project");
  }

  await assertNoBlockingComments(organizationId, projectId, {
    lineItemId,
    groupId: lineItem.groupId,
    actionLabel: "pull this item",
  });

  await convex.mutation(api.projectLineItems.update, {
    id: lineItemId,
    patch: { prepStatus: "PULLED", updatedAt: Date.now() },
  });
  const result = await convex.query(api.projectLineItems.getById, { id: lineItemId });
  const [grafted] = await attachLineItemModels(organizationId, [
    { ...result, modelId: result?.modelId ?? null },
  ]);

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

  // Rebuild the accessory profile directly from Convex (asset / assetBulkChild /
  // modelBulkAccessory are Convex-only — Phase C mega-flip). Replaces
  // resolveAssetAccessories' prisma reads. org-scoped (assetId can be a scan value).
  const convex = await getConvexClient();
  const asset = await getAssetById(assetId);
  if (!asset || asset.organizationId !== organizationId) {
    return serialize({ serialised: [], bulk: [] });
  }

  const [childAssetDocs, childBulkDocs, modelBulks, modelMap] = await Promise.all([
    convex.query(api.assets.listByParentAssetId, { parentAssetId: assetId, orgId: organizationId }),
    convex.query(api.assetBulkChildren.listByParentAssetId, { parentAssetId: assetId, orgId: organizationId }),
    asset.modelId
      ? convex.query(api.modelBulkAccessories.listByModelId, { modelId: asset.modelId, organizationId })
      : Promise.resolve([]),
    getModelMap(organizationId),
  ]);

  // assetBulkChildren docs carry only bulkAssetId — resolve each child's bulk
  // asset for its modelId (the model name shown), mirroring the old
  // resolveAssetAccessories `bulkAsset.modelId` join.
  const childBulkAssetDocs = await Promise.all(
    childBulkDocs.map((b) => getBulkAssetById(b.bulkAssetId)),
  );
  const childBulkModelIdById = new Map(
    childBulkAssetDocs.filter((d): d is NonNullable<typeof d> => d != null).map((d) => [d.id, d.modelId]),
  );

  // Asset-level bulk children win by bulkAssetId over inherited model accessories.
  const assetBulkIds = new Set(childBulkDocs.map((b) => b.bulkAssetId));

  const serialised = childAssetDocs.map((c) => ({
    id: c.id,
    name: c.modelId ? modelMap.get(c.modelId)?.name ?? null : null,
  }));

  const bulk = [
    ...childBulkDocs.map((b) => {
      const bulkModelId = childBulkModelIdById.get(b.bulkAssetId) ?? null;
      return {
        id: b.bulkAssetId,
        name: bulkModelId ? modelMap.get(bulkModelId)?.name ?? null : null,
        quantity: b.quantity,
      };
    }),
    ...modelBulks
      .filter((m) => !assetBulkIds.has(m.bulkAssetId))
      .map((m) => ({
        id: m.bulkAssetId,
        name: m.bulkAssetModelId ? modelMap.get(m.bulkAssetModelId)?.name ?? null : null,
        quantity: m.quantity,
      })),
  ];

  return serialize({ serialised, bulk });
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

  const convex = await getConvexClient();
  // Resolve the line item (group for the blocker gate + bulkAssetId fallback).
  const lineItem = await convex.query(api.projectLineItems.getById, { id: lineItemId });
  if (!lineItem || lineItem.projectId !== projectId || lineItem.organizationId !== organizationId) {
    throw new Error("Line item not found in project");
  }
  await assertNoBlockingComments(organizationId, projectId, {
    lineItemId,
    groupId: lineItem.groupId,
    actionLabel: "prep this item",
  });

  // Prep creates/marks a ProjectLineItemUnit — never splits the line (Convex mutation).
  const now = Date.now();
  await convex.mutation(api.checkRecordOps.prepItem, {
    organizationId,
    projectId,
    lineItemId,
    ...(assetId ? { assetId } : {}),
    ...(!assetId && lineItem.bulkAssetId ? { bulkAssetId: lineItem.bulkAssetId } : {}),
    ...(quantity != null ? { quantity } : {}),
    prepContainer: prepContainer ?? undefined,
    ...(includeAccessoryIds ? { includeAccessoryIds } : {}),
    now,
  });
  const result = await convex.query(api.projectLineItems.getById, { id: lineItemId });

  const prepModel = result?.modelId ? await getModelById(result.modelId) : null;
  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: lineItemId,
    entityName: prepModel?.name || "Line item",
    summary: "Prepped item (no checks required)",
    projectId,
    assetId: assetId || result?.assetId || undefined,
  });

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

  const convex = await getConvexClient();
  await convex.mutation(api.checkRecordOps.deprepItem, {
    organizationId,
    projectId,
    lineItemId,
    quantity,
    now: Date.now(),
  });
  const result = await convex.query(api.projectLineItems.getById, { id: lineItemId });
  if (!result) throw new Error("Line item not found in project");
  const [grafted] = await attachLineItemModels(organizationId, [
    { ...result, modelId: result.modelId ?? null },
  ]);

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

  const convex = await getConvexClient();
  const lineItem = await convex.query(api.projectLineItems.getById, { id: data.lineItemId });
  if (!lineItem || lineItem.projectId !== data.projectId || lineItem.organizationId !== organizationId) {
    throw new Error("Line item not found in project");
  }

  // Write RETURN-context check records (saveCheckRecords only reads checkItem +
  // pushes to the sink — no Prisma writes, so plain client is fine as the tx).
  // assetId may be empty if the return-tab scan already disconnected it — that's OK,
  // saveCheckRecords skips the asset connect when assetId is falsy.
  const checkRecordSink: CheckRecordDoc[] = [];
  const resolvedAssetId = data.assetId || lineItem.assetId || "";
  await saveCheckRecords(
    prisma,
    organizationId,
    userId,
    resolvedAssetId,
    data.lineItemId,
    data.bulkAssetId || lineItem.bulkAssetId,
    "RETURN",
    data.checks,
    null,
    checkRecordSink
  );

  // Reset prepStatus (+ scoped accessory de-prep) via Convex. The mutation
  // re-validates RETURNED status + PACKED/PENDING prepStatus (idempotent on
  // multi-unit lines). Does not touch status/returnStatus.
  await convex.mutation(api.checkRecordOps.completeCheckAndDeprepLine, {
    organizationId,
    projectId: data.projectId,
    lineItemId: data.lineItemId,
    ...(resolvedAssetId ? { resolvedAssetId } : {}),
    now: Date.now(),
  });

  // Mirror created check records to Convex post-commit.
  await writeCheckRecordsToConvex(checkRecordSink);
  const result = await convex.query(api.projectLineItems.getById, { id: data.lineItemId });
  if (!result) throw new Error("Line item not found in project");
  const [grafted] = await attachLineItemModels(organizationId, [
    { ...result, modelId: result.modelId ?? null },
  ]);

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

  const convex = await getConvexClient();
  const parentLi = await convex.query(api.projectLineItems.getById, { id: parentLineItemId });
  if (!parentLi || parentLi.projectId !== projectId || parentLi.organizationId !== organizationId) {
    throw new Error("Kit line item not found");
  }

  // Allow deprep if the kit or any children are in a prepped state
  // (handles edge cases where parent/children are out of sync)
  if (parentLi.prepStatus !== "PACKED" && parentLi.prepStatus !== "PULLED") {
    const children = await convex.query(api.projectLineItems.listByProject, {
      projectId,
      orgId: organizationId,
    });
    const hasPreppedChildren = children.some(
      (c) =>
        c.parentLineItemId === parentLineItemId &&
        (c.prepStatus === "PACKED" || c.prepStatus === "PULLED")
    );
    if (!hasPreppedChildren) {
      throw new Error("Kit is not prepped");
    }
  }

  await convex.mutation(api.checkRecordOps.deprepKit, {
    organizationId,
    projectId,
    parentLineItemId,
    now: Date.now(),
  });

  const kit = parentLi.kitId ? await convex.query(api.kits.getById, { id: parentLi.kitId }) : null;
  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: parentLineItemId,
    entityName: kit?.name || "Kit",
    summary: "Removed kit from prep",
    projectId,
  });

  return serialize({ success: true });
}

/**
 * Batch deprep: reverse prep for many selected items + kits in ONE server
 * round-trip + ONE atomic Convex mutation. Replaces the client-side
 * `for (const d of directDeprep) { deprepKit | deprepItem }` loop in the
 * warehouse deprep handler, which fired one round-trip per selected item/kit.
 *
 * Ops are applied server-side in array order — the same sequence the old loop
 * fired — so any shared-lineItemId ordering is preserved. Item ops run the exact
 * deprepItem logic; kit ops run the exact deprepKit tree-reset. Same DB outcome
 * as the per-op loop; only the round-trip count collapses from N to 1.
 *
 * (The single deprepKit's "Kit is not prepped" guard is a UX pre-check, not a
 * correctness gate — omitted here so one already-PENDING kit can't abort the
 * whole atomic batch; the underlying reset is a harmless no-op on such a kit.)
 */
export async function deprepItemsBatch(
  projectId: string,
  ops: Array<{ lineItemId: string; quantity?: number; isKit?: boolean }>
) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );
  if (ops.length === 0) return serialize({ ids: [] });

  const convex = await getConvexClient();
  await convex.mutation(api.checkRecordOps.deprepItems, {
    organizationId,
    projectId,
    ops,
    now: Date.now(),
  });

  // Re-read the touched lines once for activity-log naming (item → model name,
  // kit → kit name via the parent line's kitId), matching the per-op logging of
  // the single deprepItem / deprepKit actions. Deprep never deletes the line
  // itself, so every touched id still resolves.
  const distinctIds = [...new Set(ops.map((o) => o.lineItemId))];
  const rows = await convex.query(api.projectLineItems.listByIds, {
    ids: distinctIds,
    orgId: organizationId,
  });
  const lineById = new Map(rows.map((r) => [r.id, r]));
  const grafted = await attachLineItemModels(
    organizationId,
    rows.map((r) => ({ ...r, modelId: r.modelId ?? null })),
  );
  const modelNameById = new Map(grafted.map((g) => [g.id, g.model?.name ?? null]));

  const kitIds = [
    ...new Set(
      ops
        .filter((o) => o.isKit)
        .map((o) => lineById.get(o.lineItemId)?.kitId)
        .filter((x): x is string => !!x),
    ),
  ];
  const kitNameById = new Map<string, string>();
  await Promise.all(
    kitIds.map(async (kid) => {
      const kit = await convex.query(api.kits.getById, { id: kid });
      if (kit) kitNameById.set(kid, kit.name);
    }),
  );

  for (const op of ops) {
    const line = lineById.get(op.lineItemId);
    if (op.isKit) {
      const kitName = line?.kitId ? kitNameById.get(line.kitId) : undefined;
      await logActivity({
        organizationId,
        userId,
        userName,
        action: "UPDATE",
        entityType: "asset",
        entityId: op.lineItemId,
        entityName: kitName || "Kit",
        summary: "Removed kit from prep",
        projectId,
      });
    } else {
      await logActivity({
        organizationId,
        userId,
        userName,
        action: "UPDATE",
        entityType: "asset",
        entityId: op.lineItemId,
        entityName: modelNameById.get(op.lineItemId) || "Line item",
        summary: "Removed item from prep",
        projectId,
        assetId: line?.assetId || undefined,
      });
    }
  }

  return serialize({ ids: distinctIds });
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

  const convex = await getConvexClient();
  const parentLi = await convex.query(api.projectLineItems.getById, { id: parentLineItemId });
  if (!parentLi || parentLi.projectId !== projectId || parentLi.organizationId !== organizationId) {
    throw new Error("Kit line item not found");
  }

  await assertNoBlockingComments(organizationId, projectId, {
    lineItemId: parentLineItemId,
    groupId: parentLi.groupId,
    actionLabel: "prep this kit",
  });

  await convex.mutation(api.checkRecordOps.prepKitChildren, {
    organizationId,
    projectId,
    parentLineItemId,
    now: Date.now(),
  });

  const kit = parentLi.kitId ? await convex.query(api.kits.getById, { id: parentLi.kitId }) : null;
  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: parentLineItemId,
    entityName: kit?.name || "Kit",
    summary: "Kit prepped (checks completed)",
    projectId,
  });

  return serialize({ success: true });
}

export async function unpackItem(projectId: string, lineItemId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_in"
  );

  const convex = await getConvexClient();
  const lineItem = await convex.query(api.projectLineItems.getById, { id: lineItemId });
  if (!lineItem || lineItem.projectId !== projectId || lineItem.organizationId !== organizationId) {
    throw new Error("Line item not found in project");
  }

  await convex.mutation(api.projectLineItems.update, {
    id: lineItemId,
    patch: { returnStatus: "UNPACKED", updatedAt: Date.now() },
  });
  const result = await convex.query(api.projectLineItems.getById, { id: lineItemId });
  const [grafted] = await attachLineItemModels(organizationId, [
    { ...result, modelId: result?.modelId ?? null },
  ]);

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

  return serialize(grafted);
}

// ─── Composite: Check + Prep (prep flow — saves checks + sets PACKED, no deploy) ─

export async function completeCheckAndPack(data: CompleteCheckAndPackValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );
  const parsed = completeCheckAndPackSchema.parse(data);

  const convex = await getConvexClient();
  // Resolve the line item (group for the blocker gate + assetId/bulkAssetId).
  const lineItem = await convex.query(api.projectLineItems.getById, { id: parsed.lineItemId });
  if (!lineItem || lineItem.projectId !== parsed.projectId || lineItem.organizationId !== organizationId) {
    throw new Error("Line item not found in project");
  }
  await assertNoBlockingComments(organizationId, parsed.projectId, {
    lineItemId: parsed.lineItemId,
    groupId: lineItem.groupId,
    actionLabel: "complete the check & pack",
  });

  // Resolve assetId: prefer parsed value, fall back to line item's asset
  const resolvedAssetId = parsed.assetId || lineItem.assetId || "";

  // 1. Save check records (saveCheckRecords only reads checkItem + fills the
  // sink — no Prisma writes, so the plain client serves as the tx).
  const checkRecordSink: CheckRecordDoc[] = [];
  await saveCheckRecords(
    prisma,
    organizationId,
    userId,
    resolvedAssetId,
    parsed.lineItemId,
    parsed.bulkAssetId || lineItem.bulkAssetId,
    "PREP",
    parsed.checks,
    null,
    checkRecordSink
  );

  // 2. Prep — create/mark the unit (no checkout; deploy is a separate step).
  await convex.mutation(api.checkRecordOps.prepItem, {
    organizationId,
    projectId: parsed.projectId,
    lineItemId: parsed.lineItemId,
    ...(parsed.assetId ? { assetId: parsed.assetId } : {}),
    ...(!parsed.assetId && lineItem.bulkAssetId ? { bulkAssetId: lineItem.bulkAssetId } : {}),
    prepContainer: parsed.prepContainer ?? undefined,
    ...(parsed.includeAccessoryIds ? { includeAccessoryIds: parsed.includeAccessoryIds } : {}),
    now: Date.now(),
  });
  const updatedItem = await convex.query(api.projectLineItems.getById, { id: parsed.lineItemId });
  const result = { updatedItem, resolvedAssetId };

  // Mirror created check records to Convex post-commit.
  await writeCheckRecordsToConvex(checkRecordSink);

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

  return serialize(result.updatedItem);
}

// ─── Composite: Check + Flag (prep flow — faulty/TT overdue) ───────────────

export async function completeCheckAndFlag(data: CompleteCheckAndFlagValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );
  const parsed = completeCheckAndFlagSchema.parse(data);

  const convex = await getConvexClient();
  // 1. Resolve assetId from line item if not provided
  const lineItem = await convex.query(api.projectLineItems.getById, { id: parsed.lineItemId });
  if (!lineItem || lineItem.projectId !== parsed.projectId || lineItem.organizationId !== organizationId) {
    throw new Error("Line item not found in project");
  }
  const resolvedAssetId = parsed.assetId || lineItem.assetId || "";

  // 2. Save check records (saveCheckRecords only reads checkItem + fills sink).
  const checkRecordSink: CheckRecordDoc[] = [];
  await saveCheckRecords(
    prisma,
    organizationId,
    userId,
    resolvedAssetId,
    parsed.lineItemId,
    parsed.bulkAssetId || lineItem.bulkAssetId,
    "PREP",
    parsed.checks,
    null,
    checkRecordSink
  );

  // 3. Update line item to flagged status (Convex)
  await convex.mutation(api.projectLineItems.update, {
    id: parsed.lineItemId,
    patch: { prepStatus: parsed.flagType, updatedAt: Date.now() },
  });
  const updatedItem = await convex.query(api.projectLineItems.getById, { id: parsed.lineItemId });
  const result = { updatedItem, resolvedAssetId };

  // Mirror created check records to Convex post-commit.
  await writeCheckRecordsToConvex(checkRecordSink);

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

  const convex = await getConvexClient();
  // 1. Verify line item (needed to resolve assetId).
  const lineItem = await convex.query(api.projectLineItems.getById, { id: parsed.lineItemId });
  if (!lineItem || lineItem.projectId !== parsed.projectId || lineItem.organizationId !== organizationId) {
    throw new Error("Line item not found in project");
  }

  // Resolve assetId: prefer parsed value, fall back to line item's asset.
  const resolvedAssetId = parsed.assetId || lineItem.assetId || "";

  // 2. Save check records (saveCheckRecords only reads checkItem + fills sink).
  const checkRecordSink: CheckRecordDoc[] = [];
  await saveCheckRecords(
    prisma,
    organizationId,
    userId,
    resolvedAssetId,
    parsed.lineItemId,
    parsed.bulkAssetId || lineItem.bulkAssetId,
    "RETURN",
    parsed.checks,
    null,
    checkRecordSink
  );

  // 3. Perform the actual return via the canonical Convex mutation — does
  //    returnLineUnits + rollup + accessory cascade + scan log + asset status
  //    all in-mutation (parsed.locationId is honored by the mutation's default
  //    location resolution; explicit per-call location is no longer needed).
  await convex.mutation(api.warehouseOps.checkinItems, {
    organizationId,
    projectId: parsed.projectId,
    userId,
    items: [
      {
        lineItemId: parsed.lineItemId,
        ...(parsed.assetId ? { assetId: parsed.assetId } : {}),
        returnCondition: parsed.condition,
        quantity: 1,
        ...(parsed.notes ? { notes: parsed.notes } : {}),
      },
    ],
    now: Date.now(),
  });
  const updatedItem = await convex.query(api.projectLineItems.getById, { id: parsed.lineItemId });
  const result = { updatedItem, resolvedAssetId };

  // Write check records to Convex post-commit (Phase B).
  await writeCheckRecordsToConvex(checkRecordSink);

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

  // saveCheckRecords only reads checkItem (kept Prisma table) + builds the
  // Convex-ready docs — no Prisma writes, so no transaction is needed.
  const records = await saveCheckRecords(
    prisma,
    organizationId,
    userId,
    parsed.assetId,
    null,
    parsed.bulkAssetId,
    "AD_HOC",
    parsed.checks
  );

  // Mirror created check records to Convex post-commit (the return value IS
  // the created rows).
  await writeCheckRecordsToConvex(records);

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

  const asset = await getAssetByAssetTag(organizationId, assetTag);

  if (!asset) {
    return serialize({ found: false as const, asset: null });
  }

  // model name + check-item count live in Convex — resolve from the model map
  // + the model-check-item count map, not a Prisma join/_count.
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
  // Read-rewired to Convex (Phase A) — see src/lib/check-record-read.ts.
  return serialize(await getCheckHistoryRows(organizationId, assetId, context));
}

export async function getModelFailureAnalytics(modelId: string) {
  const { organizationId } = await getOrgContext();
  // Read-rewired to Convex (Phase A) — see src/lib/check-record-read.ts.
  return serialize(await getModelFailureAnalyticsRows(organizationId, modelId));
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

  const checkRecordSink: CheckRecordDoc[] = [];
  // saveCheckRecords only reads checkItem + fills the sink — no Prisma writes.
  await saveCheckRecords(
    prisma,
    organizationId,
    userId,
    "", // no specific asset for kit-level
    lineItemId,
    null,
    context,
    checks,
    kitId,
    checkRecordSink
  );

  // Mirror created check records to Convex post-commit.
  await writeCheckRecordsToConvex(checkRecordSink);

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

  const checkRecordSink: CheckRecordDoc[] = [];

  // Verify line item exists + resolve assetId (Convex read).
  const convex = await getConvexClient();
  const lineItem = await convex.query(api.projectLineItems.getById, { id: lineItemId });
  if (!lineItem || lineItem.organizationId !== organizationId) {
    throw new Error("Line item not found");
  }
  const resolvedAssetId = assetId || lineItem.assetId || "";

  // saveCheckRecords only reads checkItem + fills the sink — no Prisma writes.
  await saveCheckRecords(
    prisma,
    organizationId,
    userId,
    resolvedAssetId,
    lineItemId,
    bulkAssetId || lineItem.bulkAssetId,
    context,
    checks,
    null,
    checkRecordSink
  );

  // Mirror created check records to Convex post-commit.
  await writeCheckRecordsToConvex(checkRecordSink);

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
