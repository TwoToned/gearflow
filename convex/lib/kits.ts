import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { createId } from "@paralleldrive/cuid2";
import { ensureSerialisedUnit, ensureBulkUnit, lineUnits } from "./fulfillment";

type Ctx = MutationCtx;
type KitChild = Doc<"projectLineItems">;

// `by_cuid` is a global (non-org-scoped) Convex index — this is the single accessor for
// it (R-8.3.4). Callers MUST still check the returned doc's `organizationId` before
// trusting it; this helper does not scope by org.
export async function getKitByCuid(ctx: QueryCtx | MutationCtx, id: string) {
  return await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}

/**
 * A kit parent line's own member children — kit children are `isKitChild: true`
 * with no `childKind` (only an accessory child ever sets `childKind: "ACCESSORY"`;
 * `childKind: "KIT"` is never written in production — see FEATUREDOCS/09's "Line
 * Item Representation"). Shared by the deploy-lock gate and the reconcile below
 * so they can't drift on what counts as "this kit line's children" (R-9.8).
 */
export async function kitChildrenOf(ctx: Ctx, organizationId: string, parentLineItemId: string) {
  return (
    await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", parentLineItemId)).collect()
  ).filter((c) => c.organizationId === organizationId && c.isKitChild && c.childKind !== "ACCESSORY");
}

export type KitLineReconcileResult = {
  added: number;
  removed: number;
  /** Added with no price of its own — a KIT_PRICE kit's bundle price never
   *  changes for a new member (nothing to assign), and an ITEMIZED member
   *  whose model has no `defaultRentalPrice` configured lands unpriced too,
   *  same as at add-time via `createKitLineItemCore`. Surfaced separately so
   *  the caller can flag "N added — review pricing" rather than imply a new
   *  member always shows up priced. */
  unpricedAdded: number;
};

type WantedKitMembers = { assetIds: Set<string>; bulkQty: Map<string, number> };

async function loadWantedKitMembers(ctx: Ctx, kitId: string): Promise<{ serialized: Doc<"kitSerializedItems">[]; bulk: Doc<"kitBulkItems">[]; wanted: WantedKitMembers }> {
  const serialized = await ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect();
  const bulk = await ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect();
  return {
    serialized,
    bulk,
    wanted: { assetIds: new Set(serialized.map((s) => s.assetId)), bulkQty: new Map(bulk.map((b) => [b.bulkAssetId, b.quantity])) },
  };
}

function isWantedKitChild(child: KitChild, wanted: WantedKitMembers): boolean {
  if (child.assetId) return wanted.assetIds.has(child.assetId);
  if (child.bulkAssetId) return wanted.bulkQty.has(child.bulkAssetId);
  return false;
}

/** Delete every existing child the kit no longer has this member for. */
async function dropUnwantedKitChildren(ctx: Ctx, existing: KitChild[], wanted: WantedKitMembers): Promise<number> {
  let removed = 0;
  for (const child of existing) {
    if (isWantedKitChild(child, wanted)) continue;
    for (const u of await lineUnits(ctx, child.id)) await ctx.db.delete(u._id);
    await ctx.db.delete(child._id);
    removed++;
  }
  return removed;
}

/** Rescale one kept bulk member's quantity (and, in ITEMIZED mode, its price)
 *  when the kit's own configured quantity for it changed since. No-op if this
 *  child isn't a bulk member, or the kit's quantity for it is unchanged. */
async function rescaleKeptBulkKitChild(ctx: Ctx, child: KitChild, wanted: WantedKitMembers, itemized: boolean, now: number): Promise<void> {
  if (!child.bulkAssetId) return;
  const wantQty = wanted.bulkQty.get(child.bulkAssetId);
  if (wantQty == null || wantQty === child.quantity) return;
  const shape = await bulkKitMemberShape(ctx, child.bulkAssetId, wantQty, itemized);
  await ctx.db.patch(child._id, {
    quantity: wantQty,
    description: shape.description,
    unitPrice: shape.total != null ? shape.total / wantQty : child.unitPrice,
    lineTotal: shape.total,
    updatedAt: now,
  });
}

async function rescaleKeptBulkKitChildren(ctx: Ctx, existing: KitChild[], wanted: WantedKitMembers, itemized: boolean): Promise<void> {
  const now = Date.now();
  for (const child of existing) await rescaleKeptBulkKitChild(ctx, child, wanted, itemized, now);
}

/** Shared insert base for a newly-reconciled kit member child — same shape
 *  `createKitLineItemCore` inserts at add-time, minus the fields it derives
 *  per-member (id/modelId/assetId-or-bulkAssetId/description/quantity/price). */
function kitChildInsertBase(parentLine: { organizationId: string; projectId: string; versionId: string | null | undefined; id: string; categoryId: string | null | undefined; groupId: string | null | undefined }) {
  return {
    organizationId: parentLine.organizationId,
    projectId: parentLine.projectId,
    versionId: parentLine.versionId ?? undefined,
    type: "EQUIPMENT" as const,
    isKitChild: true,
    parentLineItemId: parentLine.id,
    categoryId: parentLine.categoryId ?? undefined,
    groupId: parentLine.groupId ?? undefined,
    pricingType: "PER_DAY" as const,
    duration: 1,
    status: "CONFIRMED" as const,
  };
}

type ReconcileParentLine = {
  id: string;
  kitId: string;
  organizationId: string;
  projectId: string;
  versionId: string | null | undefined;
  pricingMode: "KIT_PRICE" | "ITEMIZED" | undefined;
  categoryId: string | null | undefined;
  groupId: string | null | undefined;
};

type InsertCounts = { added: number; unpricedAdded: number };

/** Resolve a newly-added serialized member's insert shape — its model, display
 *  name, and (ITEMIZED only) unit price off the model's `defaultRentalPrice`.
 *  Split out purely to keep the loop that calls it under the complexity budget
 *  (R-3.6): the branching lives here, one call site per member there.
 *  R-3.6 justification: complexity 11 — an optional-chained lookup (asset may
 *  lack a model) feeding a 2-condition price ternary; irreducible without
 *  losing the null-safety, same shape as `createKitLineItemCore`'s own inline
 *  version of this exact computation. */
async function serializedKitMemberShape(ctx: Ctx, assetId: string, itemized: boolean): Promise<{ modelId: string | undefined; description: string; price: number | undefined }> {
  const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", assetId)).unique();
  const model = asset?.modelId ? await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", asset.modelId!)).unique() : null;
  const price = itemized && model?.defaultRentalPrice != null ? Number(model.defaultRentalPrice) : undefined;
  return { modelId: asset?.modelId, description: model?.name ?? asset?.modelId ?? "", price };
}

/** Bulk-member counterpart of `serializedKitMemberShape` — same pricing rule,
 *  scaled by the kit-configured quantity.
 *  R-3.6 justification: complexity 11, same irreducible shape as its
 *  serialized counterpart above. */
async function bulkKitMemberShape(ctx: Ctx, bulkAssetId: string, quantity: number, itemized: boolean): Promise<{ modelId: string | undefined; description: string; total: number | undefined }> {
  const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", bulkAssetId)).unique();
  const model = ba?.modelId ? await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", ba.modelId!)).unique() : null;
  const total = itemized && model?.defaultRentalPrice != null ? Number(model.defaultRentalPrice) * quantity : undefined;
  return { modelId: ba?.modelId, description: `${quantity}x ${model?.name ?? ba?.modelId ?? ""}`, total };
}

/** Insert a child for every kit-configured serialized member the line doesn't
 *  have one for yet. `sort` is mutated as a 1-element box so serialized and
 *  bulk inserts share one sortOrder sequence. */
async function insertMissingSerializedKitChildren(
  ctx: Ctx,
  parentLine: ReconcileParentLine,
  base: ReturnType<typeof kitChildInsertBase>,
  serialized: Doc<"kitSerializedItems">[],
  existingAssetIds: Set<string>,
  itemized: boolean,
  sort: { n: number },
): Promise<InsertCounts> {
  const now = Date.now();
  const counts: InsertCounts = { added: 0, unpricedAdded: 0 };
  for (const si of serialized) {
    if (existingAssetIds.has(si.assetId)) continue;
    const shape = await serializedKitMemberShape(ctx, si.assetId, itemized);
    const childId = createId();
    await ctx.db.insert("projectLineItems", {
      ...base, id: childId, lineageId: childId, modelId: shape.modelId, assetId: si.assetId,
      description: shape.description, quantity: 1, unitPrice: shape.price, lineTotal: shape.price,
      sortOrder: sort.n++, createdAt: now, updatedAt: now,
    });
    await ensureSerialisedUnit(ctx, { organizationId: parentLine.organizationId, lineItemId: childId, assetId: si.assetId });
    counts.added++;
    if (shape.price == null) counts.unpricedAdded++;
  }
  return counts;
}

/** Bulk-member counterpart of `insertMissingSerializedKitChildren`. */
async function insertMissingBulkKitChildren(
  ctx: Ctx,
  parentLine: ReconcileParentLine,
  base: ReturnType<typeof kitChildInsertBase>,
  bulk: Doc<"kitBulkItems">[],
  existingBulkIds: Set<string>,
  itemized: boolean,
  sort: { n: number },
): Promise<InsertCounts> {
  const now = Date.now();
  const counts: InsertCounts = { added: 0, unpricedAdded: 0 };
  for (const bi of bulk) {
    if (existingBulkIds.has(bi.bulkAssetId)) continue;
    const shape = await bulkKitMemberShape(ctx, bi.bulkAssetId, bi.quantity, itemized);
    const childId = createId();
    await ctx.db.insert("projectLineItems", {
      ...base, id: childId, lineageId: childId, modelId: shape.modelId, bulkAssetId: bi.bulkAssetId,
      description: shape.description, quantity: bi.quantity,
      unitPrice: shape.total != null ? shape.total / bi.quantity : undefined, lineTotal: shape.total,
      sortOrder: sort.n++, createdAt: now, updatedAt: now,
    });
    await ensureBulkUnit(ctx, { organizationId: parentLine.organizationId, lineItemId: childId, bulkAssetId: bi.bulkAssetId, quantity: bi.quantity });
    counts.added++;
    if (shape.total == null) counts.unpricedAdded++;
  }
  return counts;
}

/** Insert a child for every kit member the line doesn't have one for yet —
 *  orchestrates the serialized + bulk halves above and sums their counts. */
async function insertMissingKitChildren(
  ctx: Ctx,
  parentLine: ReconcileParentLine,
  serialized: Doc<"kitSerializedItems">[],
  bulk: Doc<"kitBulkItems">[],
  existing: KitChild[],
  itemized: boolean,
): Promise<InsertCounts> {
  const existingAssetIds = new Set(existing.filter((c) => c.assetId).map((c) => c.assetId as string));
  const existingBulkIds = new Set(existing.filter((c) => c.bulkAssetId).map((c) => c.bulkAssetId as string));
  const base = kitChildInsertBase(parentLine);
  const sort = { n: existing.length };

  const serializedCounts = await insertMissingSerializedKitChildren(ctx, parentLine, base, serialized, existingAssetIds, itemized, sort);
  const bulkCounts = await insertMissingBulkKitChildren(ctx, parentLine, base, bulk, existingBulkIds, itemized, sort);

  return { added: serializedCounts.added + bulkCounts.added, unpricedAdded: serializedCounts.unpricedAdded + bulkCounts.unpricedAdded };
}

/**
 * Diff a kit parent line's current children against the kit's CURRENT
 * `KitSerializedItem`/`KitBulkItem` membership and reconcile: insert a child
 * for every member the line doesn't have yet, delete a child for every one no
 * longer on the kit, and rescale a kept bulk member's quantity if the kit's
 * own configured quantity changed since. Pricing mirrors `createKitLineItemCore`
 * exactly (same itemized-vs-bundle branch, same model-rate lookup) — see
 * `KitLineReconcileResult.unpricedAdded`'s doc comment for what a newly-added
 * member gets instead of a price. The caller owns the deploy-lock gate (skip a
 * line with ANY deployed unit, parent or child) — this function has no way to
 * know that's safe on its own, so it always reconciles unconditionally.
 */
export async function reconcileKitLineChildren(ctx: Ctx, parentLine: ReconcileParentLine): Promise<KitLineReconcileResult> {
  const itemized = parentLine.pricingMode === "ITEMIZED";
  const existing = await kitChildrenOf(ctx, parentLine.organizationId, parentLine.id);
  const { serialized, bulk, wanted } = await loadWantedKitMembers(ctx, parentLine.kitId);

  const removed = await dropUnwantedKitChildren(ctx, existing, wanted);
  await rescaleKeptBulkKitChildren(ctx, existing, wanted, itemized);
  const { added, unpricedAdded } = await insertMissingKitChildren(ctx, parentLine, serialized, bulk, existing, itemized);

  return { added, removed, unpricedAdded };
}
