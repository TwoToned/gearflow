import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireService } from "./lib/auth";
import { assertTestTagAllowsCheckout } from "./lib/testtag";
import {
  ensureSerialisedUnit,
  ensureBulkUnit,
  expandAccessoriesForAsset,
  syncLineItemRollup,
  returnLineUnits,
  checkinAccessoryChildren,
} from "./lib/fulfillment";

/**
 * Warehouse checkout / check-in — Convex port of warehouse.ts checkOutItems /
 * checkInItems (Phase C mega-flip). Each was one Prisma $transaction coupling
 * asset.status + unit status + line rollup; here it's one atomic Convex mutation
 * (serializable → OCC prevents two projects deploying the same asset). The T&T
 * compliance gate (was a Convex query mid-tx) is inlined via ctx.db
 * (lib/testtag.ts). Scan logs are written in-mutation (assetScanLogs is Convex).
 * Permissions / activity-log / model-attach stay in the server action.
 */

type Ctx = MutationCtx;

async function lineByCuid(ctx: Ctx, id: string) {
  return await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}
async function assetByCuid(ctx: Ctx, id: string) {
  return await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}
async function lineUnits(ctx: Ctx, lineItemId: string) {
  return await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId)).collect();
}
async function unitByCuid(ctx: Ctx, id: string) {
  return await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}
function scanLog(ctx: Ctx, doc: Record<string, unknown>) {
  return ctx.db.insert("assetScanLogs", { id: createId(), ...doc } as never);
}

// ── Checkout helpers ─────────────────────────────────────────────────────────

/** Returns "continue" when the asset is already on its own unit (skip finalize). */
async function checkOutSerializedItem(
  ctx: Ctx,
  p: { organizationId: string; lineItemId: string; targetAssetId: string; userId: string; projectLocationId: string | null; projectId: string; notes?: string; now: number },
): Promise<"continue" | "done"> {
  const asset = await assetByCuid(ctx, p.targetAssetId);
  if (!asset || asset.organizationId !== p.organizationId) throw new ConvexError("Asset not found in this organization");
  if (asset.status === "CHECKED_OUT") {
    const ownUnit = await ctx.db
      .query("projectLineItemUnits")
      .withIndex("by_lineItemId_assetId", (q) => q.eq("lineItemId", p.lineItemId).eq("assetId", p.targetAssetId))
      .unique();
    if (ownUnit && ownUnit.status === "CHECKED_OUT") return "continue";
    throw new ConvexError(`Asset ${asset.assetTag} is already deployed`);
  }
  if (asset.status === "RETIRED" || asset.status === "IN_MAINTENANCE" || asset.status === "LOST") {
    throw new ConvexError(`Asset ${asset.assetTag} is ${(asset.status as string).replace("_", " ").toLowerCase()} and cannot be deployed`);
  }
  const { id: unitId } = await ensureSerialisedUnit(ctx, { organizationId: p.organizationId, lineItemId: p.lineItemId, assetId: p.targetAssetId });
  const unit = await unitByCuid(ctx, unitId);
  if (unit && unit.status !== "CHECKED_OUT") {
    await ctx.db.patch(unit._id, { status: "CHECKED_OUT", checkedOutAt: p.now, checkedOutById: p.userId, updatedAt: p.now });
  }
  await ctx.db.patch(asset._id, { status: "CHECKED_OUT", ...(p.projectLocationId ? { locationId: p.projectLocationId } : {}), updatedAt: p.now });
  await scanLog(ctx, { organizationId: p.organizationId, assetId: p.targetAssetId, projectId: p.projectId, action: "CHECK_OUT", scannedById: p.userId, scannedAt: p.now, notes: p.notes ?? undefined });
  return "done";
}

async function checkOutBulkItem(
  ctx: Ctx,
  p: { organizationId: string; lineItemId: string; lineItemQuantity: number; bulkAssetId: string; checkoutQty: number; userId: string; projectId: string; notes?: string; now: number },
): Promise<void> {
  const { id: unitId } = await ensureBulkUnit(ctx, { organizationId: p.organizationId, lineItemId: p.lineItemId, bulkAssetId: p.bulkAssetId, quantity: p.checkoutQty });
  const unit = await unitByCuid(ctx, unitId);
  if (unit) {
    await ctx.db.patch(unit._id, { status: "CHECKED_OUT", quantity: p.checkoutQty, checkedOutAt: p.now, checkedOutById: p.userId, updatedAt: p.now });
  }
  await scanLog(ctx, { organizationId: p.organizationId, bulkAssetId: p.bulkAssetId, projectId: p.projectId, action: "CHECK_OUT", scannedById: p.userId, scannedAt: p.now, notes: p.notes || `Checked out ${p.checkoutQty} of ${p.lineItemQuantity}` });
}

async function checkOutDeployWholeLine(ctx: Ctx, p: { lineItemId: string; lineItemQuantity: number; userId: string; now: number }): Promise<void> {
  const line = await lineByCuid(ctx, p.lineItemId);
  if (line) {
    await ctx.db.patch(line._id, { status: "CHECKED_OUT", checkedOutQuantity: p.lineItemQuantity, checkedOutAt: p.now, checkedOutById: p.userId, updatedAt: p.now });
  }
}

/** Cascade checkout to a parent line's accessory children (per parent unit / whole line). */
async function checkoutAccessoryChildren(
  ctx: Ctx,
  p: { organizationId: string; projectId: string; parentLineItemId: string; parentUnitAssetId: string | null; userId: string; projectLocationId: string | null; now: number },
): Promise<{ assetsTouched: string[] }> {
  const children = (
    await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", p.parentLineItemId)).collect()
  ).filter((c) => c.organizationId === p.organizationId && c.childKind === "ACCESSORY");
  if (children.length === 0) return { assetsTouched: [] };

  const units: Array<{ _id: import("./_generated/dataModel").Id<"projectLineItemUnits">; assetId?: string; bulkAssetId?: string; status?: string }> = [];
  for (const child of children) {
    for (const u of await lineUnits(ctx, child.id)) {
      if (u.status === "CHECKED_OUT") continue;
      if (p.parentUnitAssetId && u.parentUnitAssetId !== p.parentUnitAssetId) continue;
      units.push(u);
    }
  }
  // Gate the accessory units actually flipping now (unit-scoped, like the source).
  await assertTestTagAllowsCheckout(ctx, p.organizationId, {
    assetIds: units.map((u) => u.assetId).filter((x): x is string => !!x),
    bulkAssetIds: units.map((u) => u.bulkAssetId).filter((x): x is string => !!x),
  });

  const assetsTouched: string[] = [];
  for (const u of units) {
    await ctx.db.patch(u._id, { status: "CHECKED_OUT", checkedOutAt: p.now, checkedOutById: p.userId, updatedAt: p.now });
    if (u.assetId) {
      const asset = await assetByCuid(ctx, u.assetId);
      if (asset) await ctx.db.patch(asset._id, { status: "CHECKED_OUT", ...(p.projectLocationId ? { locationId: p.projectLocationId } : {}), updatedAt: p.now });
      assetsTouched.push(u.assetId);
      await scanLog(ctx, { organizationId: p.organizationId, assetId: u.assetId, projectId: p.projectId, action: "CHECK_OUT", scannedById: p.userId, scannedAt: p.now, notes: "Accessory — moved with parent" });
    } else if (u.bulkAssetId) {
      await scanLog(ctx, { organizationId: p.organizationId, bulkAssetId: u.bulkAssetId, projectId: p.projectId, action: "CHECK_OUT", scannedById: p.userId, scannedAt: p.now, notes: "Accessory — moved with parent" });
    }
  }
  for (const child of children) await syncLineItemRollup(ctx, child.id);
  return { assetsTouched };
}

async function finalizeCheckoutItem(
  ctx: Ctx,
  p: { organizationId: string; lineItemId: string; targetAssetId: string | null; projectId: string; userId: string; projectLocationId: string | null; includeAccessories: boolean; now: number },
): Promise<void> {
  if (p.includeAccessories) {
    if (p.targetAssetId) {
      await expandAccessoriesForAsset(ctx, { organizationId: p.organizationId, lineItemId: p.lineItemId, assetId: p.targetAssetId });
    }
    await checkoutAccessoryChildren(ctx, {
      organizationId: p.organizationId, projectId: p.projectId, parentLineItemId: p.lineItemId,
      parentUnitAssetId: p.targetAssetId, userId: p.userId, projectLocationId: p.projectLocationId, now: p.now,
    });
  }
  await syncLineItemRollup(ctx, p.lineItemId);
}

/** Batch T&T preflight: gather every asset/bulk id the batch will touch and assert. */
async function gatherTestTagAssetsAndAssert(
  ctx: Ctx,
  organizationId: string,
  projectId: string,
  items: Array<{ lineItemId: string; assetId?: string }>,
): Promise<Array<{ id: string; assetId?: string; bulkAssetId?: string }>> {
  const preflightLineItems: Array<{ id: string; assetId?: string; bulkAssetId?: string }> = [];
  const assetIds: string[] = [];
  const bulkIds: string[] = [];
  for (const it of items) {
    const li = await lineByCuid(ctx, it.lineItemId);
    if (!li || li.organizationId !== organizationId || li.projectId !== projectId) continue;
    preflightLineItems.push({ id: li.id, assetId: li.assetId, bulkAssetId: li.bulkAssetId });
    if (li.assetId) assetIds.push(li.assetId);
    if (li.bulkAssetId) bulkIds.push(li.bulkAssetId);
    for (const u of await lineUnits(ctx, li.id)) {
      if (u.assetId) assetIds.push(u.assetId);
      if (u.bulkAssetId) bulkIds.push(u.bulkAssetId);
    }
    if (it.assetId) assetIds.push(it.assetId);
  }
  await assertTestTagAllowsCheckout(ctx, organizationId, { assetIds, bulkAssetIds: bulkIds });
  return preflightLineItems;
}

/** Expand "deploy whole prepped line" into one item per prepped unit. */
async function expandPrepUnitAssignments(
  ctx: Ctx,
  organizationId: string,
  items: Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string }>,
  preflight: Array<{ id: string; assetId?: string; bulkAssetId?: string }>,
): Promise<Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string }>> {
  const out: Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string }> = [];
  for (const item of items) {
    if (item.assetId) { out.push(item); continue; }
    const row = preflight.find((l) => l.id === item.lineItemId);
    if (row?.assetId || row?.bulkAssetId) { out.push(item); continue; }
    const units = (await lineUnits(ctx, item.lineItemId))
      .filter((u) => u.status !== "CHECKED_OUT" && (u.assetId || u.bulkAssetId))
      .sort((a, b) => a.ordinal - b.ordinal);
    if (units.length === 0) { out.push(item); continue; }
    const want = item.quantity ?? units.length;
    const toDeploy = units.slice(0, Math.max(1, Math.min(want, units.length)));
    for (const u of toDeploy) {
      out.push({ lineItemId: item.lineItemId, ...(u.assetId ? { assetId: u.assetId } : { quantity: u.quantity ?? 1 }), notes: item.notes });
    }
  }
  return out;
}

// ── Mutations ────────────────────────────────────────────────────────────────

const checkoutItemArg = v.object({
  lineItemId: v.string(),
  assetId: v.optional(v.string()),
  quantity: v.optional(v.number()),
  notes: v.optional(v.string()),
});

export const checkoutItems = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    userId: v.string(),
    items: v.array(checkoutItemArg),
    includeAccessories: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).unique();
    if (!project || project.organizationId !== a.organizationId) throw new ConvexError("Project not found");
    const projectLocationId = project.locationId ?? null;

    const preflight = await gatherTestTagAssetsAndAssert(ctx, a.organizationId, a.projectId, a.items);
    const expanded = await expandPrepUnitAssignments(ctx, a.organizationId, a.items, preflight);

    const updated = new Set<string>();
    for (const item of expanded) {
      const lineItem = await lineByCuid(ctx, item.lineItemId);
      if (!lineItem || lineItem.projectId !== a.projectId || lineItem.organizationId !== a.organizationId) {
        throw new ConvexError(`Line item ${item.lineItemId} not found in project`);
      }
      const targetAssetId = item.assetId || lineItem.assetId || null;
      if (targetAssetId) {
        const res = await checkOutSerializedItem(ctx, {
          organizationId: a.organizationId, lineItemId: lineItem.id, targetAssetId, userId: a.userId,
          projectLocationId, projectId: a.projectId, notes: item.notes, now: a.now,
        });
        if (res === "continue") continue;
      } else if (lineItem.bulkAssetId) {
        await checkOutBulkItem(ctx, {
          organizationId: a.organizationId, lineItemId: lineItem.id, lineItemQuantity: lineItem.quantity ?? 0,
          bulkAssetId: lineItem.bulkAssetId, checkoutQty: item.quantity || lineItem.quantity || 0, userId: a.userId,
          projectId: a.projectId, notes: item.notes, now: a.now,
        });
      } else {
        await checkOutDeployWholeLine(ctx, { lineItemId: lineItem.id, lineItemQuantity: lineItem.quantity ?? 0, userId: a.userId, now: a.now });
        updated.add(lineItem.id);
        continue;
      }
      await finalizeCheckoutItem(ctx, {
        organizationId: a.organizationId, lineItemId: lineItem.id, targetAssetId, projectId: a.projectId,
        userId: a.userId, projectLocationId, includeAccessories: a.includeAccessories, now: a.now,
      });
      updated.add(lineItem.id);
    }
    return { updatedLineIds: [...updated] };
  },
});

export const checkinItems = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    userId: v.string(),
    items: v.array(v.object({
      lineItemId: v.string(),
      assetId: v.optional(v.string()),
      returnCondition: v.union(v.literal("GOOD"), v.literal("DAMAGED"), v.literal("MISSING")),
      quantity: v.optional(v.number()),
      notes: v.optional(v.string()),
    })),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    // org default location to restore assets to
    const locs = await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.organizationId)).collect();
    const defaultLocationId = locs.find((l) => l.isDefault)?.id ?? null;

    const updated = new Set<string>();
    for (const item of a.items) {
      const { unitsFlipped, assetsTouched } = await returnLineUnits(ctx, {
        organizationId: a.organizationId, projectId: a.projectId, lineItemId: item.lineItemId, assetId: item.assetId,
        returnCondition: item.returnCondition, quantity: item.quantity, notes: item.notes, userId: a.userId, defaultLocationId,
      });
      if (assetsTouched.length === 1) {
        await scanLog(ctx, { organizationId: a.organizationId, assetId: assetsTouched[0], projectId: a.projectId, action: "CHECK_IN", scannedById: a.userId, scannedAt: a.now, notes: item.notes ?? undefined });
      } else if (unitsFlipped > 0 || assetsTouched.length > 0) {
        await scanLog(ctx, { organizationId: a.organizationId, projectId: a.projectId, action: "CHECK_IN", scannedById: a.userId, scannedAt: a.now, notes: item.notes || `Returned ${unitsFlipped} unit(s)` });
      }
      await syncLineItemRollup(ctx, item.lineItemId);
      if (unitsFlipped > 0) {
        await checkinAccessoryChildren(ctx, {
          organizationId: a.organizationId, projectId: a.projectId, parentLineItemId: item.lineItemId,
          returnCondition: item.returnCondition ?? "GOOD", userId: a.userId, defaultLocationId, returnedAssetId: item.assetId ?? null,
        });
      }
      updated.add(item.lineItemId);
    }
    return { updatedLineIds: [...updated] };
  },
});
