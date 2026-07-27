import { ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import type { MutationCtx } from "../_generated/server";
import { writeActivityLog } from "./audit";
import { bumpAssetCounters, bumpBulkCounters } from "./counters";
import { findAssetConflict } from "./availabilityCore";

/**
 * WS11 (#950) — sale-stock mechanics shared by `addNative` / `addLineItemSmartNative`
 * / `patchNative` / `removeNative` / `removeManyNative` (convex/lineItemWrites.ts)
 * and the dedicated `unsellLineItemNative` reversal mutation. Kept in one module so
 * the decrement/restore/COGS-adjacent bookkeeping has exactly one implementation
 * (R-3.1) no matter which write path triggers it.
 *
 * Two independent stock sources, per the spec's "hybrid taxonomy" decision:
 *  - NEW_STOCK: `Model.saleStockQuantity`, a single per-model pool independent of
 *    rental assets/bulk ("we sell *a* SM58, not *our* SM58"). Oversell is allowed
 *    (warn, never block) — negative feeds the Overbookings & Gaps board's
 *    "Sale stock to procure" section (overbookingBoard.ts).
 *  - FROM_RENTAL_STOCK: an owned unit/bulk-qty is disposed of. Serialised units go
 *    terminal (`AssetStatus: "SOLD"`); bulk quantities decrement `totalQuantity` +
 *    `availableQuantity` via `adjustBulkTotal`, floored at what's currently deployed
 *    (a unit out on a job can't be sold out from under it). Both are reversible
 *    ("un-sell" — see `unsellSerializedAsset` / the negative-qty branch of
 *    `adjustBulkTotal`).
 */

export interface SaleActor {
  userId: string;
  userName: string;
}

/**
 * New-stock sale: adjust `Model.saleStockQuantity` by `delta` (negative = a sale
 * reserving stock, positive = a restore — cancel/delete/qty-decrease). A no-op
 * model lookup miss (deleted mid-flight, cross-org) is swallowed rather than
 * thrown — this runs as a side effect of a line-item write that has already
 * committed; a dangling model reference shouldn't roll back the whole write.
 */
export async function adjustModelSaleStock(
  ctx: MutationCtx,
  args: {
    modelId: string;
    orgId: string;
    delta: number;
    projectId: string;
    lineItemId: string;
    actor: SaleActor;
    now: number;
  },
): Promise<void> {
  if (args.delta === 0) return;
  const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", args.modelId)).first();
  if (!model || model.organizationId !== args.orgId) return;

  const from = model.saleStockQuantity ?? 0;
  const to = from + args.delta;
  await ctx.db.patch(model._id, { saleStockQuantity: to, updatedAt: args.now });

  const qty = Math.abs(args.delta);
  await writeActivityLog(ctx, {
    id: createId(),
    organizationId: args.orgId,
    action: "UPDATE",
    entityType: "model",
    entityId: args.modelId,
    entityName: model.name,
    userId: args.actor.userId,
    userName: args.actor.userName,
    summary:
      args.delta < 0
        ? `Sold ${qty} of ${model.name} from new stock (sale stock ${from} -> ${to})`
        : `Restored ${qty} of ${model.name} to sale stock (${from} -> ${to})`,
    details: { saleStock: { from, to, projectId: args.projectId, lineItemId: args.lineItemId } },
    projectId: args.projectId,
    createdAt: args.now,
  });
}

/**
 * Sell-from-rental-stock, SERIALISED: flips the asset to the terminal "SOLD"
 * status (isActive:false, mirroring `assetWrites.ts`'s `archiveNative` RETIRED
 * pattern so dashboard counters + fleet ROI's `isActive` filter drop it
 * automatically — see `convex/roi.ts` fleetCapitalFor). Pre-checks
 * `findAssetConflict` for a FUTURE overlapping booking and returns a
 * non-blocking warning string when one exists — the non-blocking philosophy
 * every other availability gate in this codebase already follows (warn, never
 * throw). Throws only on genuine errors (asset missing/cross-org/already sold).
 */
export async function sellSerializedAssetForSale(
  ctx: MutationCtx,
  args: {
    assetId: string;
    orgId: string;
    projectId: string;
    lineItemId: string;
    rentalStart: number | null;
    rentalEnd: number | null;
    actor: SaleActor;
    now: number;
  },
): Promise<string | undefined> {
  const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", args.assetId)).first();
  if (!asset || asset.organizationId !== args.orgId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Asset not found in this organization." });
  }
  if (asset.status === "SOLD") {
    throw new ConvexError({ code: "ALREADY_SOLD", message: `${asset.assetTag} has already been sold.` });
  }

  let warning: string | undefined;
  if (args.rentalStart != null && args.rentalEnd != null) {
    const conflict = await findAssetConflict(ctx, {
      assetId: args.assetId,
      orgId: args.orgId,
      excludeProjectId: args.projectId,
      rentalStart: args.rentalStart,
      rentalEnd: args.rentalEnd,
    });
    if (conflict) {
      warning = `${asset.assetTag} is also booked on ${conflict.projectNumber} — ${conflict.name}. Sold anyway — that booking will need a different unit.`;
    }
  }

  const before = { isActive: asset.isActive, status: asset.status };
  await ctx.db.patch(asset._id, { status: "SOLD", isActive: false, updatedAt: args.now });
  await bumpAssetCounters(ctx, args.orgId, before, { isActive: false, status: "SOLD" });

  await writeActivityLog(ctx, {
    id: createId(),
    organizationId: args.orgId,
    action: "UPDATE",
    entityType: "asset",
    entityId: args.assetId,
    entityName: asset.assetTag,
    userId: args.actor.userId,
    userName: args.actor.userName,
    summary: `Sold ${asset.assetTag} from rental stock`,
    details: { sale: { projectId: args.projectId, lineItemId: args.lineItemId } },
    assetId: args.assetId,
    projectId: args.projectId,
    createdAt: args.now,
  });

  return warning;
}

/** Reverse `sellSerializedAssetForSale` ("un-sell"): SOLD -> AVAILABLE. */
export async function unsellSerializedAsset(
  ctx: MutationCtx,
  args: { assetId: string; orgId: string; projectId: string; lineItemId: string; actor: SaleActor; now: number },
): Promise<void> {
  const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", args.assetId)).first();
  if (!asset || asset.organizationId !== args.orgId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Asset not found in this organization." });
  }
  if (asset.status !== "SOLD") {
    throw new ConvexError({ code: "NOT_SOLD", message: `${asset.assetTag} is not marked sold.` });
  }
  const before = { isActive: asset.isActive, status: asset.status };
  await ctx.db.patch(asset._id, { status: "AVAILABLE", isActive: true, updatedAt: args.now });
  await bumpAssetCounters(ctx, args.orgId, before, { isActive: true, status: "AVAILABLE" });

  await writeActivityLog(ctx, {
    id: createId(),
    organizationId: args.orgId,
    action: "UPDATE",
    entityType: "asset",
    entityId: args.assetId,
    entityName: asset.assetTag,
    userId: args.actor.userId,
    userName: args.actor.userName,
    summary: `Un-sold ${asset.assetTag} — restored to Available`,
    assetId: args.assetId,
    projectId: args.projectId,
    createdAt: args.now,
  });
}

/**
 * Sell-from-rental-stock, BULK: decrements `totalQuantity` AND `availableQuantity`
 * together, FLOORED at the currently-deployed quantity (`totalQuantity -
 * availableQuantity` — units out on a job right now can't be sold out from under
 * it). Status auto-flips to "OUT_OF_STOCK" at zero (spec decision); a restore
 * (`qty < 0`) that brings it back above zero flips an OUT_OF_STOCK row back to
 * ACTIVE. Returns the ACTUAL quantity decremented, which can be less than
 * requested when the floor clamps it — the caller surfaces the difference as a
 * non-blocking warning rather than silently under-selling.
 */
export async function adjustBulkTotal(
  ctx: MutationCtx,
  args: {
    bulkAssetId: string;
    orgId: string;
    /** Positive = sell (decrement), negative = restore (un-sell/delete/qty-down). */
    qty: number;
    projectId: string;
    lineItemId: string;
    reason: string;
    actor: SaleActor;
    now: number;
  },
): Promise<{ actualQty: number }> {
  if (args.qty === 0) return { actualQty: 0 };
  const bulk = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", args.bulkAssetId)).first();
  if (!bulk || bulk.organizationId !== args.orgId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Bulk asset not found in this organization." });
  }

  const totalBefore = bulk.totalQuantity ?? 0;
  const availableBefore = bulk.availableQuantity ?? 0;
  const deployed = Math.max(0, totalBefore - availableBefore);

  let totalAfter: number;
  let availableAfter: number;
  if (args.qty > 0) {
    totalAfter = Math.max(deployed, totalBefore - args.qty);
    const actualSold = totalBefore - totalAfter;
    availableAfter = Math.max(0, availableBefore - actualSold);
  } else {
    const restore = -args.qty;
    totalAfter = totalBefore + restore;
    availableAfter = availableBefore + restore;
  }

  const patch: { totalQuantity: number; availableQuantity: number; updatedAt: number; status?: "ACTIVE" | "OUT_OF_STOCK" } = {
    totalQuantity: totalAfter,
    availableQuantity: availableAfter,
    updatedAt: args.now,
  };
  if (totalAfter <= 0) patch.status = "OUT_OF_STOCK";
  else if (bulk.status === "OUT_OF_STOCK") patch.status = "ACTIVE";

  await ctx.db.patch(bulk._id, patch);
  await bumpBulkCounters(
    ctx,
    args.orgId,
    { isActive: bulk.isActive, totalQuantity: totalBefore },
    { isActive: bulk.isActive, totalQuantity: totalAfter },
  );

  const delta = totalAfter - totalBefore;
  await writeActivityLog(ctx, {
    id: createId(),
    organizationId: args.orgId,
    action: "UPDATE",
    entityType: "bulkAsset",
    entityId: args.bulkAssetId,
    entityName: bulk.assetTag,
    userId: args.actor.userId,
    userName: args.actor.userName,
    summary:
      delta < 0
        ? `Sold ${-delta} of ${bulk.assetTag} from rental stock (${totalBefore} -> ${totalAfter})`
        : `Restored ${delta} of ${bulk.assetTag} to rental stock (${totalBefore} -> ${totalAfter})`,
    details: { reason: args.reason, delta, projectId: args.projectId, lineItemId: args.lineItemId },
    projectId: args.projectId,
    createdAt: args.now,
  });

  return { actualQty: Math.abs(delta) };
}
