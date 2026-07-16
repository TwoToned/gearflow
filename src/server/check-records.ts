"use server";

import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity, logActivityMany } from "@/lib/activity-log";
import { assertNoBlockingComments, getProjectBlockingSummary } from "@/lib/blocking-comments-read";
import { evaluateBlockingGate } from "@/lib/blocking-comments-gate";
import { getModelMap, getModelById, type ConvexModel } from "@/lib/models-read";
import { getAssetById, getAssetByAssetTag, getBulkAssetById } from "@/lib/assets-read";
import {
  getCheckHistoryRows,
  getModelFailureAnalyticsRows,
} from "@/lib/check-record-read";
import { getModelCheckItemCountMap } from "@/lib/line-item-tree-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

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

/**
 * Batch prep: pack many units in ONE server round-trip + ONE atomic Convex
 * mutation. Replaces the client-side `for (…) await prepItemDirect(…)` loops in
 * the warehouse (finish-check-queue prep, "Prep Selected", asset-picker confirm),
 * which fired one network round-trip per unit (up to items×qty = dozens). Same
 * fulfillment outcome as the per-item loop: items are applied in array order, so
 * multiple units on the SAME lineItemId are packed deterministically (the old
 * loop's "sequential to avoid same-lineItemId races" ordering constraint).
 *
 * Callers must pre-expand quantity into one entry per unit exactly where the old
 * loop did (e.g. a bulk-no-check line of qty 3 → three {quantity:1} entries) so
 * the server reproduces the identical sequence of prepUnit calls.
 */
export async function prepItemsBatch(
  projectId: string,
  items: Array<{
    lineItemId: string;
    assetId?: string;
    quantity?: number;
    prepContainer?: string | null;
    includeAccessoryIds?: string[];
  }>
) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );
  if (items.length === 0) return serialize([]);

  const convex = await getConvexClient();

  // Blocking-comment gate — mirror prepItemDirect's per-item check, but read the
  // project summary + line groups once instead of per item. A project-level
  // blocker (or a blocker on any prepped line / its group) fails the whole batch,
  // just as the old loop threw on the first blocked item.
  const distinctLineIds = [...new Set(items.map((i) => i.lineItemId))];
  const [summary, lineDocs] = await Promise.all([
    getProjectBlockingSummary(organizationId, projectId),
    convex.query(api.projectLineItems.listByIds, { ids: distinctLineIds, orgId: organizationId }),
  ]);
  const groupById = new Map(lineDocs.map((l) => [l.id, l.groupId ?? null]));
  for (const lineItemId of distinctLineIds) {
    const gate = evaluateBlockingGate(summary, {
      lineItemId,
      groupId: groupById.get(lineItemId) ?? null,
      actionLabel: "prep this item",
    });
    if (gate.blocked) throw new Error(gate.message);
  }

  // One atomic mutation packs every unit (identical to N sequential prepItem calls).
  const now = Date.now();
  const res = await convex.mutation(api.checkRecordOps.prepItems, {
    organizationId,
    projectId,
    items,
    now,
  });

  // Re-read the touched lines once and log one activity entry per prepped item
  // (matches prepItemDirect's per-call log). Model name resolved from one map.
  const rows = await Promise.all(
    res.ids.map((id: string) => convex.query(api.projectLineItems.getById, { id })),
  );
  const grafted = await attachLineItemModels(
    organizationId,
    rows.filter((r): r is NonNullable<typeof r> => r != null).map((r) => ({ ...r, modelId: r.modelId ?? null })),
  );
  const lineById = new Map(grafted.map((g) => [g.id, g]));
  // One audit row per prepped item (matches prepItemDirect), written in ONE batch
  // instead of N sequential inserts.
  await logActivityMany(
    items.map((item) => {
      const line = lineById.get(item.lineItemId);
      return {
        organizationId,
        userId,
        userName,
        action: "UPDATE",
        entityType: "asset",
        entityId: item.lineItemId,
        entityName: line?.model?.name || "Line item",
        summary: "Prepped item (no checks required)",
        projectId,
        assetId: item.assetId || line?.assetId || undefined,
      };
    }),
  );

  return serialize(grafted);
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

  // One audit row per deprepped item/kit, written in ONE batch instead of N.
  await logActivityMany(
    ops.map((op) => {
      const line = lineById.get(op.lineItemId);
      if (op.isKit) {
        const kitName = line?.kitId ? kitNameById.get(line.kitId) : undefined;
        return {
          organizationId,
          userId,
          userName,
          action: "UPDATE",
          entityType: "asset",
          entityId: op.lineItemId,
          entityName: kitName || "Kit",
          summary: "Removed kit from prep",
          projectId,
        };
      }
      return {
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
      };
    }),
  );

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

/**
 * Bulk single-call kit prep (Phase 3 bulk invariant): prep N kit trees in ONE
 * server round-trip + ONE atomic Convex mutation (`prepKitsBatch`). Replaces the
 * warehouse "Prep Selected" loop that fired one `prepKitChildren` round-trip per
 * kit. The blocking-comment gate mirrors `prepKitChildren`'s per-kit check but
 * reads the project summary + line groups ONCE. Per-kit org/project validation is
 * the MUTATION's job — a kit not on this org's project surfaces in `res.errors`
 * (partial-success) instead of sinking the rest. Returns succeeded parent line ids
 * + per-kit errors.
 */
export async function prepKitsBatch(
  projectId: string,
  parentLineItemIds: string[]
) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );
  const unique = [...new Set(parentLineItemIds)];
  if (unique.length === 0) return serialize({ succeeded: [] as string[], errors: [] as { lineItemId: string; message: string }[] });

  const convex = await getConvexClient();

  // Blocking-comment gate — one project summary + one line-groups read (was a
  // per-kit assertNoBlockingComments in the singular). A project-level blocker
  // (or a blocker on any prepped kit line / its group) fails the whole batch, just
  // as the old loop threw on the first blocked kit.
  const [summary, lineDocs] = await Promise.all([
    getProjectBlockingSummary(organizationId, projectId),
    convex.query(api.projectLineItems.listByIds, { ids: unique, orgId: organizationId }),
  ]);
  // Scope the gate to THIS org+project — listByIds is a global-index read, so a
  // foreign/cross-project id must not feed its groupId to the project's blocking gate
  // (it would falsely abort the whole batch). Cross-project/foreign ids fall through
  // to the mutation, which skips them per-item with an error (partial-success).
  const inProject = lineDocs.filter((l) => l.projectId === projectId && l.organizationId === organizationId);
  const groupById = new Map(inProject.map((l) => [l.id, l.groupId ?? null]));
  const kitIdByLine = new Map(inProject.map((l) => [l.id, l.kitId ?? null]));
  for (const lineItemId of unique) {
    if (!groupById.has(lineItemId)) continue; // not in this project → mutation handles it
    const gate = evaluateBlockingGate(summary, {
      lineItemId,
      groupId: groupById.get(lineItemId) ?? null,
      actionLabel: "prep this kit",
    });
    if (gate.blocked) throw new Error(gate.message);
  }

  // ONE atomic array mutation preps every kit tree (partial-success on org/project).
  const { succeeded, errors } = await convex.mutation(api.checkRecordOps.prepKitsBatch, {
    organizationId,
    projectId,
    parentLineItemIds: unique,
    now: Date.now(),
  });

  // One audit row per prepped kit (kit name via the parent line's kitId), matching
  // the single prepKitChildren's per-kit log.
  const kitIds = [...new Set(succeeded.map((id: string) => kitIdByLine.get(id)).filter((x): x is string => !!x))];
  const kitNameById = new Map<string, string>();
  await Promise.all(
    kitIds.map(async (kid) => {
      const kit = await convex.query(api.kits.getById, { id: kid });
      if (kit) kitNameById.set(kid, kit.name);
    }),
  );
  await logActivityMany(
    succeeded.map((lineItemId: string) => {
      const kid = kitIdByLine.get(lineItemId);
      return {
        organizationId,
        userId,
        userName,
        action: "UPDATE",
        entityType: "asset",
        entityId: lineItemId,
        entityName: (kid && kitNameById.get(kid)) || "Kit",
        summary: "Kit prepped (checks completed)",
        projectId,
      };
    }),
  );

  return serialize({ succeeded, errors });
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

