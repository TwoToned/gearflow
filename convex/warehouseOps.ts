import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireService } from "./lib/auth";
import { assertTestTagAllowsCheckout } from "./lib/testtag";
import { adjustBulkAvailability, coalesceAdjustments, type BulkAdjustment } from "./lib/inventory";
import { type CheckInItem, type CheckInItemType, itemGroupKey, distributeReturn } from "./lib/bulkCheckin";
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

/**
 * Deploy the prepped "generic" units of an untagged multi-quantity line (rows
 * with neither an asset nor a bulk asset — the partial-prep model). Flips up to
 * `want` of them to CHECKED_OUT so a partial deploy leaves the rest waiting.
 * Returns false when the line has no such units (legacy whole-line deploy).
 */
async function checkOutGenericUnits(
  ctx: Ctx,
  p: { organizationId: string; lineItemId: string; want?: number; userId: string; projectId: string; notes?: string; now: number },
): Promise<boolean> {
  const units = (await lineUnits(ctx, p.lineItemId))
    .filter((u) => !u.assetId && !u.bulkAssetId && u.status !== "CHECKED_OUT" && u.status !== "RETURNED" && u.prepStatus === "PACKED")
    .sort((a, b) => a.ordinal - b.ordinal);
  if (units.length === 0) return false;
  const want = p.want ?? units.length;
  const toFlip = units.slice(0, Math.max(1, Math.min(want, units.length)));
  for (const u of toFlip) {
    await ctx.db.patch(u._id, { status: "CHECKED_OUT", checkedOutAt: p.now, checkedOutById: p.userId, updatedAt: p.now });
  }
  await scanLog(ctx, { organizationId: p.organizationId, projectId: p.projectId, action: "CHECK_OUT", scannedById: p.userId, scannedAt: p.now, notes: p.notes || `Deployed ${toFlip.length} unit(s)` });
  return true;
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
): Promise<{
  preflight: Array<{ id: string; assetId?: string; bulkAssetId?: string }>;
  unitsByLine: Map<string, Awaited<ReturnType<typeof lineUnits>>>;
}> {
  const preflightLineItems: Array<{ id: string; assetId?: string; bulkAssetId?: string }> = [];
  // Cache each line's units here so the immediately-following expand stage reuses
  // them instead of re-reading. Safe: both stages run BEFORE any mutation, so the
  // snapshot is stable. (Do NOT extend this cache into the mutating main loop.)
  const unitsByLine = new Map<string, Awaited<ReturnType<typeof lineUnits>>>();
  const assetIds: string[] = [];
  const bulkIds: string[] = [];
  for (const it of items) {
    const li = await lineByCuid(ctx, it.lineItemId);
    if (!li || li.organizationId !== organizationId || li.projectId !== projectId) continue;
    preflightLineItems.push({ id: li.id, assetId: li.assetId, bulkAssetId: li.bulkAssetId });
    if (li.assetId) assetIds.push(li.assetId);
    if (li.bulkAssetId) bulkIds.push(li.bulkAssetId);
    const units = await lineUnits(ctx, li.id);
    unitsByLine.set(li.id, units);
    for (const u of units) {
      if (u.assetId) assetIds.push(u.assetId);
      if (u.bulkAssetId) bulkIds.push(u.bulkAssetId);
    }
    if (it.assetId) assetIds.push(it.assetId);
  }
  await assertTestTagAllowsCheckout(ctx, organizationId, { assetIds, bulkAssetIds: bulkIds });
  return { preflight: preflightLineItems, unitsByLine };
}

/** Expand "deploy whole prepped line" into one item per prepped unit. */
async function expandPrepUnitAssignments(
  ctx: Ctx,
  organizationId: string,
  items: Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string }>,
  preflight: Array<{ id: string; assetId?: string; bulkAssetId?: string }>,
  unitsByLine: Map<string, Awaited<ReturnType<typeof lineUnits>>>,
): Promise<Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string }>> {
  const out: Array<{ lineItemId: string; assetId?: string; quantity?: number; notes?: string }> = [];
  for (const item of items) {
    if (item.assetId) { out.push(item); continue; }
    const row = preflight.find((l) => l.id === item.lineItemId);
    if (row?.assetId || row?.bulkAssetId) { out.push(item); continue; }
    // Reuse the units gather already read this same (pre-mutation) snapshot;
    // fall back to a read only for a line gather skipped (wrong org/project).
    const units = (unitsByLine.get(item.lineItemId) ?? (await lineUnits(ctx, item.lineItemId)))
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

    const { preflight, unitsByLine } = await gatherTestTagAssetsAndAssert(ctx, a.organizationId, a.projectId, a.items);
    const expanded = await expandPrepUnitAssignments(ctx, a.organizationId, a.items, preflight, unitsByLine);

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
        // No serialised asset, no bulk asset. Prefer deploying the prepped
        // generic units (untagged multi-qty partial support); only legacy lines
        // that were never unit-prepped fall back to the whole-line flip.
        const flipped = await checkOutGenericUnits(ctx, {
          organizationId: a.organizationId, lineItemId: lineItem.id, want: item.quantity,
          userId: a.userId, projectId: a.projectId, notes: item.notes, now: a.now,
        });
        if (!flipped) {
          await checkOutDeployWholeLine(ctx, { lineItemId: lineItem.id, lineItemQuantity: lineItem.quantity ?? 0, userId: a.userId, now: a.now });
          updated.add(lineItem.id);
          continue;
        }
        // Generic units flipped — fall through to finalize (accessories + rollup).
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

async function defaultLocationId(ctx: Ctx, organizationId: string): Promise<string | null> {
  const locs = await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).collect();
  return locs.find((l) => l.isDefault)?.id ?? null;
}
async function linesByAsset(ctx: Ctx, assetId: string, organizationId: string) {
  return (await ctx.db.query("projectLineItems").withIndex("by_assetId", (q) => q.eq("assetId", assetId)).collect())
    .filter((l) => l.organizationId === organizationId);
}

// ── Kit checkout / checkin helpers ───────────────────────────────────────────

async function kitByCuid(ctx: Ctx, id: string) {
  return await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}
async function kitParentLine(ctx: Ctx, projectId: string, organizationId: string, kitId: string) {
  const rows = await ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect();
  return rows.find((r) => r.projectId === projectId && r.organizationId === organizationId && !r.isKitChild) ?? null;
}
async function childLines(ctx: Ctx, parentId: string, organizationId: string) {
  return (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", parentId)).collect())
    .filter((c) => c.organizationId === organizationId);
}
async function kitSerializedAssetIds(ctx: Ctx, kitId: string): Promise<string[]> {
  return (await ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect()).map((k) => k.assetId);
}
async function collectKitBulkAdjustments(ctx: Ctx, kitId: string, organizationId: string, sign: -1 | 1): Promise<BulkAdjustment[]> {
  const bulks = await ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect();
  return bulks.filter((b) => b.organizationId === organizationId).map((b) => ({ bulkAssetId: b.bulkAssetId, delta: sign * b.quantity }));
}
async function setAssetsStatus(ctx: Ctx, assetIds: string[], status: string, locationId: string | null, clearLocIfNull: boolean, now: number) {
  for (const id of assetIds) {
    const a = await assetByCuid(ctx, id);
    if (!a) continue;
    if (locationId != null) {
      await ctx.db.patch(a._id, { status: status as typeof a.status, locationId, updatedAt: now });
    } else if (clearLocIfNull) {
      const { _id, _creationTime, locationId: _l, ...rest } = a;
      await ctx.db.replace(_id, { ...rest, status: status as typeof a.status, updatedAt: now });
    } else {
      await ctx.db.patch(a._id, { status: status as typeof a.status, updatedAt: now });
    }
  }
}

export const checkoutKit = mutation({
  args: { organizationId: v.string(), projectId: v.string(), userId: v.string(), kitId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kitLine = await kitParentLine(ctx, a.projectId, a.organizationId, a.kitId);
    if (!kitLine) throw new ConvexError("Kit not found on this project");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).unique();
    const loc = project?.locationId ?? null;

    const children = await childLines(ctx, kitLine.id, a.organizationId);
    const nestedKitChildren = children.filter((c) => c.kitId);
    const nestedKitIds = nestedKitChildren.map((c) => c.kitId!) as string[];

    // T&T preflight over this kit + nested kits' permanent composition.
    const ttAssets: string[] = [...(await kitSerializedAssetIds(ctx, a.kitId))];
    const ttBulk: string[] = (await ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", a.kitId)).collect()).map((b) => b.bulkAssetId);
    for (const nk of nestedKitIds) {
      ttAssets.push(...(await kitSerializedAssetIds(ctx, nk)));
      ttBulk.push(...(await ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", nk)).collect()).map((b) => b.bulkAssetId));
    }
    await assertTestTagAllowsCheckout(ctx, a.organizationId, { assetIds: ttAssets, bulkAssetIds: ttBulk });

    const deploy = { status: "CHECKED_OUT" as const, checkedOutQuantity: 1, checkedOutAt: a.now, checkedOutById: a.userId, updatedAt: a.now };
    await ctx.db.patch(kitLine._id, deploy);
    for (const c of children) await ctx.db.patch(c._id, deploy);

    for (const nestedChild of nestedKitChildren) {
      for (const gc of await childLines(ctx, nestedChild.id, a.organizationId)) await ctx.db.patch(gc._id, deploy);
      const nk = await kitByCuid(ctx, nestedChild.kitId!);
      if (nk) await ctx.db.patch(nk._id, { status: "CHECKED_OUT", ...(loc ? { locationId: loc } : {}), updatedAt: a.now });
      await setAssetsStatus(ctx, await kitSerializedAssetIds(ctx, nestedChild.kitId!), "CHECKED_OUT", loc, false, a.now);
    }

    await setAssetsStatus(ctx, children.filter((c) => c.assetId).map((c) => c.assetId!), "CHECKED_OUT", loc, false, a.now);
    for (const nestedChild of nestedKitChildren) {
      const gcs = await childLines(ctx, nestedChild.id, a.organizationId);
      await setAssetsStatus(ctx, gcs.filter((g) => g.assetId).map((g) => g.assetId!), "CHECKED_OUT", loc, false, a.now);
    }

    const kit = await kitByCuid(ctx, a.kitId);
    if (kit) await ctx.db.patch(kit._id, { status: "CHECKED_OUT", ...(loc ? { locationId: loc } : {}), updatedAt: a.now });
    await setAssetsStatus(ctx, await kitSerializedAssetIds(ctx, a.kitId), "CHECKED_OUT", loc, false, a.now);

    const adjustments: BulkAdjustment[] = [...(await collectKitBulkAdjustments(ctx, a.kitId, a.organizationId, -1))];
    for (const nk of nestedKitIds) adjustments.push(...(await collectKitBulkAdjustments(ctx, nk, a.organizationId, -1)));
    if (adjustments.length > 0) await adjustBulkAvailability(ctx, a.organizationId, coalesceAdjustments(adjustments));

    await scanLog(ctx, { organizationId: a.organizationId, kitId: a.kitId, projectId: a.projectId, action: "CHECK_OUT", scannedById: a.userId, scannedAt: a.now, notes: "Kit deployed with all contents" });
    return { kitId: a.kitId, affectedKitIds: [a.kitId, ...nestedKitIds] };
  },
});

export const checkinKit = mutation({
  args: {
    organizationId: v.string(), projectId: v.string(), userId: v.string(), kitId: v.string(),
    returnCondition: v.union(v.literal("GOOD"), v.literal("DAMAGED"), v.literal("MISSING")), now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kitLine = await kitParentLine(ctx, a.projectId, a.organizationId, a.kitId);
    if (!kitLine) throw new ConvexError("Kit not found on this project");
    const locs = await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.organizationId)).collect();
    const defaultLocationId = locs.find((l) => l.isDefault)?.id ?? null;

    const newKitStatus = a.returnCondition === "DAMAGED" ? "IN_MAINTENANCE" : a.returnCondition === "MISSING" ? "INCOMPLETE" : "AVAILABLE";
    const assetStatus = a.returnCondition === "DAMAGED" ? "IN_MAINTENANCE" : a.returnCondition === "MISSING" ? "LOST" : "AVAILABLE";
    const ret = { status: "RETURNED" as const, returnedQuantity: 1, returnedAt: a.now, returnedById: a.userId, returnCondition: a.returnCondition, updatedAt: a.now };

    await ctx.db.patch(kitLine._id, ret);
    const children = (await childLines(ctx, kitLine.id, a.organizationId)).filter((c) => c.status === "CHECKED_OUT");
    for (const c of children) await ctx.db.patch(c._id, ret);

    const nestedKitChildren = children.filter((c) => c.kitId);
    const nestedKitIds = nestedKitChildren.map((c) => c.kitId!) as string[];
    for (const nestedChild of nestedKitChildren) {
      for (const gc of (await childLines(ctx, nestedChild.id, a.organizationId)).filter((g) => g.status === "CHECKED_OUT")) await ctx.db.patch(gc._id, ret);
      const nk = await kitByCuid(ctx, nestedChild.kitId!);
      if (nk) await ctx.db.patch(nk._id, { status: newKitStatus, ...(defaultLocationId ? { locationId: defaultLocationId } : {}), updatedAt: a.now });
      await setAssetsStatus(ctx, await kitSerializedAssetIds(ctx, nestedChild.kitId!), assetStatus, defaultLocationId, true, a.now);
    }

    await setAssetsStatus(ctx, children.filter((c) => c.assetId).map((c) => c.assetId!), assetStatus, defaultLocationId, true, a.now);
    for (const nestedChild of nestedKitChildren) {
      const gcs = await childLines(ctx, nestedChild.id, a.organizationId);
      await setAssetsStatus(ctx, gcs.filter((g) => g.assetId).map((g) => g.assetId!), assetStatus, defaultLocationId, true, a.now);
    }

    const kit = await kitByCuid(ctx, a.kitId);
    if (kit) await ctx.db.patch(kit._id, { status: newKitStatus, ...(defaultLocationId ? { locationId: defaultLocationId } : {}), updatedAt: a.now });
    await setAssetsStatus(ctx, await kitSerializedAssetIds(ctx, a.kitId), assetStatus, defaultLocationId, true, a.now);

    const adjustments: BulkAdjustment[] = [...(await collectKitBulkAdjustments(ctx, a.kitId, a.organizationId, 1))];
    for (const nk of nestedKitIds) adjustments.push(...(await collectKitBulkAdjustments(ctx, nk, a.organizationId, 1)));
    if (adjustments.length > 0) await adjustBulkAvailability(ctx, a.organizationId, coalesceAdjustments(adjustments));

    await scanLog(ctx, { organizationId: a.organizationId, kitId: a.kitId, projectId: a.projectId, action: "CHECK_IN", scannedById: a.userId, scannedAt: a.now, notes: `Kit returned — condition: ${a.returnCondition}` });
    return { kitId: a.kitId, affectedKitIds: [a.kitId, ...nestedKitIds] };
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

// ── Force-return + container/quick-add (Group E3/E4) ──────────────────────────

const FORCE_RET = (now: number) => ({ status: "RETURNED" as const, returnedQuantity: 1, returnedAt: now, returnCondition: "GOOD" as const, updatedAt: now });

export const forceReturnAsset = mutation({
  args: { organizationId: v.string(), assetId: v.string(), userId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const asset = await assetByCuid(ctx, a.assetId);
    if (!asset || asset.organizationId !== a.organizationId) throw new ConvexError("Asset not found");
    if (asset.status === "AVAILABLE") throw new ConvexError("Asset is already available");
    const loc = await defaultLocationId(ctx, a.organizationId);
    for (const li of await linesByAsset(ctx, a.assetId, a.organizationId)) {
      if (li.status === "CHECKED_OUT") await ctx.db.patch(li._id, FORCE_RET(a.now));
    }
    await setAssetsStatus(ctx, [a.assetId], "AVAILABLE", loc, true, a.now);
    return { success: true };
  },
});

export const bulkForceReturnAssets = mutation({
  args: { organizationId: v.string(), assetIds: v.array(v.string()), userId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const loc = await defaultLocationId(ctx, a.organizationId);
    let count = 0;
    for (const assetId of a.assetIds) {
      const asset = await assetByCuid(ctx, assetId);
      if (!asset || asset.organizationId !== a.organizationId || asset.status !== "CHECKED_OUT") continue;
      for (const li of await linesByAsset(ctx, assetId, a.organizationId)) {
        if (li.status === "CHECKED_OUT") await ctx.db.patch(li._id, FORCE_RET(a.now));
      }
      await setAssetsStatus(ctx, [assetId], "AVAILABLE", loc, true, a.now);
      count++;
    }
    return { count };
  },
});

async function restoreKitParentLine(
  ctx: Ctx,
  parent: { _id: import("./_generated/dataModel").Id<"projectLineItems">; id: string; status?: string },
  organizationId: string,
  loc: string | null,
  now: number,
  kitsToRestore: Set<string>,
): Promise<void> {
  const children = await childLines(ctx, parent.id, organizationId);
  const nestedKitChildren = children.filter((c) => c.kitId);
  for (const child of nestedKitChildren) {
    const grandchildren = await childLines(ctx, child.id, organizationId);
    for (const gc of grandchildren) if (gc.status === "CHECKED_OUT") await ctx.db.patch(gc._id, FORCE_RET(now));
    await setAssetsStatus(ctx, grandchildren.filter((g) => g.assetId).map((g) => g.assetId!), "AVAILABLE", loc, true, now);
  }
  const childKitIds = nestedKitChildren.map((c) => c.kitId!) as string[];
  for (const nk of childKitIds) {
    kitsToRestore.add(nk);
    const k = await kitByCuid(ctx, nk);
    if (k) {
      if (loc != null) await ctx.db.patch(k._id, { status: "AVAILABLE", locationId: loc, updatedAt: now });
      else { const { _id, _creationTime, locationId: _l, ...rest } = k; await ctx.db.replace(_id, { ...rest, status: "AVAILABLE", updatedAt: now }); }
    }
    await setAssetsStatus(ctx, await kitSerializedAssetIds(ctx, nk), "AVAILABLE", loc, true, now);
  }
  for (const c of children) if (c.status === "CHECKED_OUT") await ctx.db.patch(c._id, FORCE_RET(now));
  await setAssetsStatus(ctx, children.filter((c) => c.assetId).map((c) => c.assetId!), "AVAILABLE", loc, true, now);
  if (parent.status === "CHECKED_OUT") await ctx.db.patch(parent._id, FORCE_RET(now));
}

export const forceReturnKit = mutation({
  args: { organizationId: v.string(), kitId: v.string(), userId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kit = await kitByCuid(ctx, a.kitId);
    if (!kit || kit.organizationId !== a.organizationId) throw new ConvexError("Kit not found");
    if (kit.status === "AVAILABLE") throw new ConvexError("Kit is already available");
    const loc = await defaultLocationId(ctx, a.organizationId);
    const kitsToRestore = new Set<string>([a.kitId]);

    const parents = (await ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", a.kitId)).collect())
      .filter((l) => l.organizationId === a.organizationId && !l.isKitChild);
    for (const p of parents) await restoreKitParentLine(ctx, p, a.organizationId, loc, a.now, kitsToRestore);

    if (loc != null) await ctx.db.patch(kit._id, { status: "AVAILABLE", locationId: loc, updatedAt: a.now });
    else { const { _id, _creationTime, locationId: _l, ...rest } = kit; await ctx.db.replace(_id, { ...rest, status: "AVAILABLE", updatedAt: a.now }); }
    await setAssetsStatus(ctx, await kitSerializedAssetIds(ctx, a.kitId), "AVAILABLE", loc, true, a.now);

    const adjustments: BulkAdjustment[] = [];
    for (const kid of kitsToRestore) adjustments.push(...(await collectKitBulkAdjustments(ctx, kid, a.organizationId, 1)));
    if (adjustments.length > 0) await adjustBulkAvailability(ctx, a.organizationId, coalesceAdjustments(adjustments));
    return { success: true, affectedKitIds: [...kitsToRestore] };
  },
});

export const quickAdd = mutation({
  args: {
    organizationId: v.string(), projectId: v.string(), modelId: v.string(),
    assetId: v.optional(v.string()), bulkAssetId: v.optional(v.string()),
    quantity: v.optional(v.number()), prepContainer: v.optional(v.string()), userId: v.string(), now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    await assertTestTagAllowsCheckout(ctx, a.organizationId, {
      assetIds: a.assetId ? [a.assetId] : [], bulkAssetIds: a.bulkAssetId ? [a.bulkAssetId] : [],
    });
    const lines = (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect())
      .filter((l) => l.organizationId === a.organizationId);
    const sortOrder = lines.reduce((m, l) => Math.max(m, l.sortOrder ?? -1), -1) + 1;
    const id = createId();
    await ctx.db.insert("projectLineItems", {
      id, organizationId: a.organizationId, projectId: a.projectId, type: "EQUIPMENT", modelId: a.modelId,
      assetId: a.assetId, bulkAssetId: a.bulkAssetId, quantity: a.quantity ?? 1, sortOrder, status: "CONFIRMED",
      checkedOutQuantity: 0, prepStatus: "PENDING", prepContainer: a.prepContainer, createdAt: a.now, updatedAt: a.now,
    });
    await scanLog(ctx, { organizationId: a.organizationId, ...(a.assetId ? { assetId: a.assetId } : {}), ...(a.bulkAssetId ? { bulkAssetId: a.bulkAssetId } : {}), projectId: a.projectId, action: "CHECK_OUT", scannedById: a.userId, scannedAt: a.now, notes: "Added to project and prepped via warehouse scan" });
    return { id };
  },
});

export const ensureContainerOnProject = mutation({
  args: { organizationId: v.string(), projectId: v.string(), assetId: v.string(), modelId: v.string(), containerName: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const existing = (await ctx.db.query("projectLineItems").withIndex("by_assetId", (q) => q.eq("assetId", a.assetId)).collect())
      .find((l) => l.projectId === a.projectId && l.organizationId === a.organizationId && l.isContainerLineItem);
    if (existing) return { id: existing.id, created: false };
    const lines = (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect())
      .filter((l) => l.organizationId === a.organizationId);
    const sortOrder = lines.reduce((m, l) => Math.max(m, l.sortOrder ?? -1), -1) + 1;
    const id = createId();
    await ctx.db.insert("projectLineItems", {
      id, organizationId: a.organizationId, projectId: a.projectId, type: "EQUIPMENT", modelId: a.modelId, assetId: a.assetId,
      quantity: 1, sortOrder, status: "CONFIRMED", checkedOutQuantity: 0, prepStatus: "PACKED", prepContainer: a.containerName,
      isContainerLineItem: true, createdAt: a.now, updatedAt: a.now,
    });
    return { id, created: true };
  },
});

export const clearPrepContainer = mutation({
  args: { organizationId: v.string(), projectId: v.string(), containerName: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const lines = (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect())
      .filter((l) => l.organizationId === a.organizationId && l.prepContainer === a.containerName);
    for (const l of lines) {
      const { _id, _creationTime, prepContainer: _p, ...rest } = l;
      await ctx.db.replace(_id, { ...rest, updatedAt: a.now });
    }
    return { success: true };
  },
});

export const syncContainerStatus = mutation({
  args: { organizationId: v.string(), projectId: v.string(), containerName: v.string(), userId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const lines = (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect())
      .filter((l) => l.organizationId === a.organizationId && l.prepContainer === a.containerName);
    const containerLI = lines.find((l) => l.isContainerLineItem);
    if (!containerLI) return { updated: false };
    const contents = lines.filter((l) => !l.isContainerLineItem);
    if (contents.length === 0) return { updated: false };
    const allDeployed = contents.every((i) => i.status === "CHECKED_OUT");
    const allReturned = contents.every((i) => i.status === "RETURNED");
    const allDeployedFlag = allDeployed && containerLI.status !== "CHECKED_OUT";
    const allReturnedFlag = allReturned && containerLI.status !== "RETURNED";
    if (!allDeployedFlag && !allReturnedFlag) return { updated: false };
    if (allDeployedFlag) {
      await ctx.db.patch(containerLI._id, { status: "CHECKED_OUT", checkedOutQuantity: 1, checkedOutAt: a.now, checkedOutById: a.userId, updatedAt: a.now });
    } else {
      await ctx.db.patch(containerLI._id, { status: "RETURNED", returnedQuantity: 1, returnedAt: a.now, returnedById: a.userId, returnCondition: "GOOD", updatedAt: a.now });
    }
    if (containerLI.assetId) {
      await setAssetsStatus(ctx, [containerLI.assetId], allDeployedFlag ? "CHECKED_OUT" : "AVAILABLE", null, false, a.now);
    }
    return { updated: true, status: allDeployedFlag ? "CHECKED_OUT" : "RETURNED" };
  },
});

// ── Bulk check-in (Group G) ───────────────────────────────────────────────────

export const checkInBulkTotals = mutation({
  args: {
    organizationId: v.string(), projectId: v.string(), userId: v.string(),
    returns: v.array(v.object({ key: v.string(), quantity: v.number(), condition: v.optional(v.union(v.literal("GOOD"), v.literal("DAMAGED"), v.literal("MISSING"))) })),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const wanted = a.returns.filter((r) => r && typeof r.quantity === "number" && r.quantity > 0);
    if (wanted.length === 0) return { returned: [] as Array<{ key: string; quantity: number; condition: string }> };

    const defaultLoc = await defaultLocationId(ctx, a.organizationId);
    // Range-scan only CHECKED_OUT lines for this project via the composite index
    // (was: collect ALL of the project's lines then JS-filter on status). The
    // remaining predicate (org / not-subhire-group / accessory-or-not-kit-child)
    // stays a JS post-filter over the now-smaller candidate set.
    const rows = (await ctx.db.query("projectLineItems")
      .withIndex("by_projectId_status", (q) => q.eq("projectId", a.projectId).eq("status", "CHECKED_OUT"))
      .collect())
      .filter((r) => r.organizationId === a.organizationId && !r.subHireGroupId && (!r.isKitChild || r.childKind === "ACCESSORY"))
      .sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0));

    // Batch-load the distinct models the rows reference once (rows share models),
    // instead of a per-row models.by_cuid point-read inside toInput.
    const modelIds = [...new Set(rows.map((r) => r.modelId).filter((m): m is string => !!m))];
    const modelById = new Map(
      (await Promise.all(
        modelIds.map((mid) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", mid)).unique()),
      ))
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .map((m) => [m.id, m] as const),
    );

    const toInput = async (child: typeof rows[number]): Promise<CheckInItem> => {
      const units = await lineUnits(ctx, child.id);
      let outstanding: number;
      if (units.length > 0) {
        outstanding = units.reduce((s, u) => u.status === "CHECKED_OUT" ? s + Math.max(0, (u.quantity ?? 0) - (u.returnedQuantity ?? 0)) : s, 0);
      } else outstanding = child.status !== "CHECKED_OUT" ? 0 : Math.max(0, (child.checkedOutQuantity ?? 0) - (child.returnedQuantity ?? 0));
      let itemType: CheckInItemType;
      if (child.childKind === "ACCESSORY") itemType = "ACCESSORY";
      else if (child.isCustomItem) itemType = "CUSTOM";
      else if (child.subHireId) itemType = "SUBHIRE";
      else if (child.bulkAssetId) itemType = "OWNED_BULK";
      else itemType = "OWNED_SERIALISED";
      const model = child.modelId ? modelById.get(child.modelId) ?? null : null;
      return {
        lineItemId: child.id, modelId: child.modelId ?? null, modelName: model?.name ?? null, modelNumber: model?.modelNumber ?? null,
        assetId: child.assetId ?? null, bulkAssetId: child.bulkAssetId ?? null, subHireId: child.subHireId ?? null,
        isCustomItem: !!child.isCustomItem, childKind: child.childKind ?? null, sortOrder: child.sortOrder ?? 0, outstanding, itemType,
      };
    };

    const byKey = new Map<string, CheckInItem[]>();
    const labelByKey = new Map<string, string>();
    for (const r of rows) {
      const input = await toInput(r);
      const key = itemGroupKey(input);
      if (!key) continue;
      (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(input);
      if (!labelByKey.has(key)) labelByKey.set(key, input.modelName ?? (input.itemType === "ACCESSORY" ? "Accessory" : "Item"));
    }

    const summary: Array<{ key: string; quantity: number; condition: string }> = [];
    for (const req of wanted) {
      const condition = req.condition ?? "GOOD";
      const groupChildren = byKey.get(req.key) ?? [];
      const { allocations, distributed } = distributeReturn(groupChildren, req.quantity);
      if (distributed < req.quantity) {
        const available = groupChildren.reduce((s, c) => s + Math.max(0, c.outstanding), 0);
        throw new ConvexError(`Cannot return ${req.quantity} of "${labelByKey.get(req.key) ?? req.key}" — only ${available} currently deployed.`);
      }
      const assetsTouched: string[] = [];
      for (const alloc of allocations) {
        if (alloc.itemType === "SUBHIRE" || alloc.itemType === "CUSTOM") {
          const line = await lineByCuid(ctx, alloc.lineItemId);
          if (!line) continue;
          const newReturned = (line.returnedQuantity ?? 0) + alloc.quantity;
          const fully = newReturned >= (line.checkedOutQuantity ?? 0);
          await ctx.db.patch(line._id, {
            status: fully ? "RETURNED" : "CHECKED_OUT", returnedQuantity: newReturned, returnCondition: condition,
            ...(fully ? { returnedAt: a.now, returnedById: a.userId } : {}), updatedAt: a.now,
          });
          continue;
        }
        const { assetsTouched: touched } = await returnLineUnits(ctx, {
          organizationId: a.organizationId, projectId: a.projectId, lineItemId: alloc.lineItemId,
          assetId: alloc.assetId ?? undefined, bulkAssetId: alloc.bulkAssetId ?? undefined,
          returnCondition: condition, quantity: alloc.quantity, userId: a.userId, defaultLocationId: defaultLoc,
        });
        await syncLineItemRollup(ctx, alloc.lineItemId);
        assetsTouched.push(...touched);
      }
      for (const assetId of assetsTouched) {
        await scanLog(ctx, { organizationId: a.organizationId, assetId, projectId: a.projectId, action: "CHECK_IN", scannedById: a.userId, scannedAt: a.now, notes: `Bulk check-in (${condition})` });
      }
      await scanLog(ctx, { organizationId: a.organizationId, projectId: a.projectId, action: "CHECK_IN", scannedById: a.userId, scannedAt: a.now, notes: `Bulk check-in: ${distributed}x ${labelByKey.get(req.key) ?? req.key} (${condition})` });
      summary.push({ key: req.key, quantity: distributed, condition });
    }
    return { returned: summary };
  },
});
