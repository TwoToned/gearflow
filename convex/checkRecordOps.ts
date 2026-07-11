import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireService } from "./lib/auth";
import { prepUnit, syncLineItemRollup } from "./lib/fulfillment";

/**
 * Check-records prep/return — Convex port of the line-item/unit writes in
 * check-records.ts (Phase C mega-flip). The check records themselves are already
 * Convex (built into a sink + written post-commit by the server action), so these
 * mutations own only the projectLineItem / projectLineItemUnit prep-state writes.
 * The return path (completeCheckAndStore) reuses warehouseOps.checkinItems; the
 * simple single-field flips (pullItem PULLED, unpackItem UNPACKED, flag) reuse the
 * generated projectLineItems.update from the server action.
 */
type Ctx = MutationCtx;

async function lineByCuid(ctx: Ctx, id: string) {
  return await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}
async function childLines(ctx: Ctx, parentId: string, organizationId: string) {
  return (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", parentId)).collect())
    .filter((c) => c.organizationId === organizationId);
}
async function assetByCuid(ctx: Ctx, id: string) {
  return await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}

/** Prep (pick-and-pack) a unit. Wraps the fulfillment prepUnit helper. */
export const prepItem = mutation({
  args: {
    organizationId: v.string(), projectId: v.string(), lineItemId: v.string(),
    assetId: v.optional(v.string()), bulkAssetId: v.optional(v.string()),
    quantity: v.optional(v.number()), prepContainer: v.optional(v.union(v.string(), v.null())),
    includeAccessoryIds: v.optional(v.array(v.string())), now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const line = await lineByCuid(ctx, a.lineItemId);
    if (!line || line.projectId !== a.projectId || line.organizationId !== a.organizationId) throw new ConvexError("Line item not found in project");
    await prepUnit(ctx, {
      organizationId: a.organizationId, lineItemId: a.lineItemId,
      assetId: a.assetId ?? null, bulkAssetId: a.assetId ? null : (a.bulkAssetId ?? line.bulkAssetId ?? null),
      quantity: a.quantity, prepContainer: a.prepContainer ?? undefined,
      includeAccessoryIds: a.includeAccessoryIds ? new Set(a.includeAccessoryIds) : null,
    });
    return { id: a.lineItemId };
  },
});

/** Batch prep: pack many units in ONE atomic mutation. Collapses the client's
 *  per-item `prepItem` round-trip loop (warehouse "Prep Selected" / finish-check-
 *  queue / asset-picker confirm) into a single call. Items are processed in the
 *  given order, so units for the SAME lineItemId are appended deterministically —
 *  identical to the old sequential prepItemDirect loop (which was ordered "to
 *  avoid race conditions when items share the same lineItemId"). One Convex
 *  transaction, so it's all-or-nothing. */
export const prepItems = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    items: v.array(
      v.object({
        lineItemId: v.string(),
        assetId: v.optional(v.string()),
        quantity: v.optional(v.number()),
        prepContainer: v.optional(v.union(v.string(), v.null())),
        includeAccessoryIds: v.optional(v.array(v.string())),
      }),
    ),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const touched = new Set<string>();
    for (const item of a.items) {
      const line = await lineByCuid(ctx, item.lineItemId);
      if (!line || line.projectId !== a.projectId || line.organizationId !== a.organizationId) {
        throw new ConvexError("Line item not found in project");
      }
      await prepUnit(ctx, {
        organizationId: a.organizationId,
        lineItemId: item.lineItemId,
        assetId: item.assetId ?? null,
        // Bulk asset is ALWAYS derived from the line (never client-supplied), so
        // a crafted request can't prep a line against an arbitrary bulk asset —
        // matching prepItemDirect, which likewise passes only line.bulkAssetId.
        bulkAssetId: item.assetId ? null : (line.bulkAssetId ?? null),
        quantity: item.quantity,
        prepContainer: item.prepContainer ?? undefined,
        includeAccessoryIds: item.includeAccessoryIds ? new Set(item.includeAccessoryIds) : null,
      });
      touched.add(item.lineItemId);
    }
    return { ids: [...touched] };
  },
});

/** Core deprep of a single line — extracted so both the single `deprepItem`
 *  mutation and the batched `deprepItems` mutation run byte-identical logic. */
async function deprepItemInner(
  ctx: Ctx,
  a: { organizationId: string; projectId: string; lineItemId: string; quantity: number; now: number },
) {
  const line = await lineByCuid(ctx, a.lineItemId);
  if (!line || line.projectId !== a.projectId || line.organizationId !== a.organizationId) throw new ConvexError("Line item not found in project");
  if (line.status === "CHECKED_OUT") throw new ConvexError("Item is already deployed — return it first");

  const prepped = (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", a.lineItemId)).collect())
    // Only still-prepped units are deprep-removable. RETURNED units are the
    // "what went out on this job" history (a returned line depreps via
    // completeCheckAndDeprepLine, which never deletes) — excluding them here
    // stops plain deprep from silently destroying that record. CANCELLED are
    // tombstones, likewise never deleted.
    .filter((u) => u.status !== "CHECKED_OUT" && u.status !== "RETURNED" && u.status !== "CANCELLED")
    .sort((x, y) => y.ordinal - x.ordinal); // highest ordinal first (LIFO)

  const isPartialBulk = prepped.length === 1 && prepped[0].bulkAssetId && !prepped[0].assetId && a.quantity < (prepped[0].quantity ?? 0);
  if (isPartialBulk) {
    await ctx.db.patch(prepped[0]._id, { quantity: (prepped[0].quantity ?? 0) - a.quantity, updatedAt: a.now });
  } else {
    const removeCount = Math.min(a.quantity, prepped.length);
    const removedParentAssetIds: string[] = [];
    for (let i = 0; i < removeCount; i++) {
      if (prepped[i].assetId) removedParentAssetIds.push(prepped[i].assetId!);
      await ctx.db.delete(prepped[i]._id);
    }
    if (removedParentAssetIds.length > 0) {
      const accChildren = (await childLines(ctx, a.lineItemId, a.organizationId)).filter((c) => c.childKind === "ACCESSORY");
      for (const child of accChildren) {
        const accUnits = (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", child.id)).collect())
          .filter((u) => u.status !== "CHECKED_OUT" && u.parentUnitAssetId && removedParentAssetIds.includes(u.parentUnitAssetId));
        for (const u of accUnits) await ctx.db.delete(u._id);
      }
      for (const child of accChildren) await syncLineItemRollup(ctx, child.id);
    }
  }

  // Clear legacy line.assetId (kit children excepted).
  if (!line.isKitChild && line.assetId) {
    const fresh = await lineByCuid(ctx, a.lineItemId);
    if (fresh) {
      const { _id, _creationTime, assetId: _a, ...rest } = fresh;
      await ctx.db.replace(_id, { ...rest, prepStatus: "PENDING", updatedAt: a.now });
    }
  } else {
    const fresh = await lineByCuid(ctx, a.lineItemId);
    if (fresh) await ctx.db.patch(fresh._id, { prepStatus: "PENDING", updatedAt: a.now });
  }
  await syncLineItemRollup(ctx, a.lineItemId);
}

/** Remove prep assignment: drop/reduce prepped units (+ cascade accessory units),
 *  clear legacy assetId, reset line prepStatus to PENDING. */
export const deprepItem = mutation({
  args: { organizationId: v.string(), projectId: v.string(), lineItemId: v.string(), quantity: v.optional(v.number()), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    await deprepItemInner(ctx, { ...a, quantity: a.quantity ?? 1 });
    return { id: a.lineItemId };
  },
});

/** Return-check deprep: reset line prepStatus PENDING (+ clear assetId) and the
 *  scoped accessory child lines + units back to PENDING. Status/returnStatus are
 *  left alone (the return-tab flow already set them). */
export const completeCheckAndDeprepLine = mutation({
  args: { organizationId: v.string(), projectId: v.string(), lineItemId: v.string(), resolvedAssetId: v.optional(v.string()), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const line = await lineByCuid(ctx, a.lineItemId);
    if (!line || line.projectId !== a.projectId || line.organizationId !== a.organizationId) throw new ConvexError("Line item not found in project");
    if (line.status !== "RETURNED") throw new ConvexError(`Deprep return check requires RETURNED status (got ${line.status})`);
    if (line.prepStatus !== "PACKED" && line.prepStatus !== "PENDING") throw new ConvexError(`Deprep return check expected prepStatus=PACKED or PENDING (got ${line.prepStatus ?? "null"})`);

    const resolvedAssetId = a.resolvedAssetId || line.assetId || "";
    if (!line.isKitChild && line.assetId) {
      const { _id, _creationTime, assetId: _a, ...rest } = line;
      await ctx.db.replace(_id, { ...rest, prepStatus: "PENDING", updatedAt: a.now });
    } else {
      await ctx.db.patch(line._id, { prepStatus: "PENDING", updatedAt: a.now });
    }

    const accChildren = (await childLines(ctx, a.lineItemId, a.organizationId)).filter((c) => c.childKind === "ACCESSORY");
    for (const child of accChildren) {
      let include = true;
      if (resolvedAssetId) {
        if (child.assetId) {
          const ca = await assetByCuid(ctx, child.assetId);
          include = ca?.parentAssetId === resolvedAssetId;
        } else {
          include = true; // shared bulk accessory line
        }
      }
      if (include) await ctx.db.patch(child._id, { prepStatus: "PENDING", updatedAt: a.now });
      const units = (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", child.id)).collect())
        .filter((u) => !resolvedAssetId || u.parentUnitAssetId === resolvedAssetId);
      for (const u of units) await ctx.db.patch(u._id, { prepStatus: "PENDING", updatedAt: a.now });
    }
    return { id: a.lineItemId };
  },
});

async function setKitTreePrep(ctx: Ctx, parentLineItemId: string, organizationId: string, now: number, mode: "PREP" | "DEPREP") {
  const children = await childLines(ctx, parentLineItemId, organizationId);
  for (const child of children) {
    if (child.status === "CHECKED_OUT" || child.status === "CANCELLED") continue;
    if (mode === "PREP") await ctx.db.patch(child._id, { status: "CONFIRMED", prepStatus: "PACKED", updatedAt: now });
    else await ctx.db.patch(child._id, { prepStatus: "PENDING", updatedAt: now });
    for (const gc of await childLines(ctx, child.id, organizationId)) {
      if (gc.status === "CHECKED_OUT" || gc.status === "CANCELLED") continue;
      if (mode === "PREP") await ctx.db.patch(gc._id, { status: "CONFIRMED", prepStatus: "PACKED", updatedAt: now });
      else await ctx.db.patch(gc._id, { prepStatus: "PENDING", updatedAt: now });
    }
  }
  const parent = await lineByCuid(ctx, parentLineItemId);
  if (parent) {
    if (mode === "PREP") await ctx.db.patch(parent._id, { status: "CONFIRMED", prepStatus: "PACKED", updatedAt: now });
    else await ctx.db.patch(parent._id, { prepStatus: "PENDING", updatedAt: now });
  }
}

export const prepKitChildren = mutation({
  args: { organizationId: v.string(), projectId: v.string(), parentLineItemId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const parent = await lineByCuid(ctx, a.parentLineItemId);
    if (!parent || parent.projectId !== a.projectId || parent.organizationId !== a.organizationId) throw new ConvexError("Kit line item not found");
    await setKitTreePrep(ctx, a.parentLineItemId, a.organizationId, a.now, "PREP");
    return { success: true };
  },
});

export const deprepKit = mutation({
  args: { organizationId: v.string(), projectId: v.string(), parentLineItemId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const parent = await lineByCuid(ctx, a.parentLineItemId);
    if (!parent || parent.projectId !== a.projectId || parent.organizationId !== a.organizationId) throw new ConvexError("Kit line item not found");
    await setKitTreePrep(ctx, a.parentLineItemId, a.organizationId, a.now, "DEPREP");
    return { success: true };
  },
});

/** Batch deprep: reverse prep for many selected items + kits in ONE atomic
 *  mutation. Collapses the client's per-op `deprepItem` / `deprepKit` round-trip
 *  loop (warehouse "Deprep Selected"). Ops are applied in the given order — the
 *  same sequence the old loop fired — so any shared-lineItemId ordering is
 *  preserved. Item ops route through deprepItemInner (byte-identical to the
 *  single deprepItem); kit ops validate the parent + reset the kit tree, exactly
 *  as the single deprepKit does. */
export const deprepItems = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    ops: v.array(
      v.object({
        lineItemId: v.string(),
        quantity: v.optional(v.number()),
        isKit: v.optional(v.boolean()),
      }),
    ),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const touched = new Set<string>();
    for (const op of a.ops) {
      if (op.isKit) {
        const parent = await lineByCuid(ctx, op.lineItemId);
        if (!parent || parent.projectId !== a.projectId || parent.organizationId !== a.organizationId) throw new ConvexError("Kit line item not found");
        await setKitTreePrep(ctx, op.lineItemId, a.organizationId, a.now, "DEPREP");
      } else {
        await deprepItemInner(ctx, {
          organizationId: a.organizationId,
          projectId: a.projectId,
          lineItemId: op.lineItemId,
          quantity: op.quantity ?? 1,
          now: a.now,
        });
      }
      touched.add(op.lineItemId);
    }
    return { ids: [...touched] };
  },
});
