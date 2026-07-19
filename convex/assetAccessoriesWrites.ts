import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { adjustBulkAvailability } from "./lib/inventory";
import * as enums from "./lib/validators";

/**
 * Native ASSET-ACCESSORY write mutations (Phase 3 browser-direct — replaces
 * addSerializedChildToAsset/addBulkChildToAsset/removeSerializedChildFromAsset/
 * removeBulkChildFromAsset in src/server/asset-accessories.ts). Gates on asset:update.
 *
 * ★ The old actions did the guard-check → pool-adjust → child-write across SEPARATE
 * Convex round-trips (a non-atomic TOCTOU the deletion map flagged). Folding each op into
 * ONE mutation makes the pre-check + pool adjustment + write ATOMIC — the guard and the
 * write see the same transaction, so two concurrent attaches of the same child (or a
 * DEDICATED draw racing the pool) can't both win.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

async function logAccessory(
  ctx: MutationCtx,
  a: { orgId: string; actor: Actor; auditId: string; now: number; parentId: string; entityName: string; summary: string; details: unknown },
) {
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.orgId, action: "UPDATE", entityType: "asset",
    entityId: a.parentId, entityName: a.entityName, assetId: a.parentId,
    userId: a.actor.userId, userName: a.actor.userName, summary: a.summary, details: a.details, createdAt: a.now,
  });
}

/** True if `assetId` is itself the parent of any serialized or bulk accessory (one-level guard). */
async function isAccessoryParent(ctx: MutationCtx, orgId: string, assetId: string): Promise<boolean> {
  const assets = await ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
  if (assets.some((a) => a.parentAssetId === assetId)) return true;
  const bulkChildren = await ctx.db.query("assetBulkChildren").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
  return bulkChildren.some((c) => c.parentAssetId === assetId);
}

export const addSerializedNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { parentAssetId: v.string(), orgId: v.string(), childAssetId: v.string(), notes: v.optional(v.string()), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "assetAccessory");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "asset", "update");
    const actor = await resolveActor(ctx, a.actor);

    if (a.childAssetId === a.parentAssetId) throw new ConvexError("Cannot attach an asset to itself");

    const parent = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", a.parentAssetId)).first();
    if (!parent || parent.organizationId !== a.orgId) throw new ConvexError("Asset not found");
    if (parent.parentAssetId) throw new ConvexError("This asset is itself an accessory. Attach accessories to a top-level asset instead.");

    const child = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", a.childAssetId)).first();
    if (!child || child.organizationId !== a.orgId) throw new ConvexError("Accessory not found");
    if ((child.status ?? "AVAILABLE") !== "AVAILABLE") throw new ConvexError(`${child.assetTag} must be AVAILABLE to attach.`);
    if (child.parentAssetId) throw new ConvexError(`${child.assetTag} is already attached to another asset.`);
    if (child.kitId) throw new ConvexError(`${child.assetTag} belongs to a kit and can't also be an accessory.`);
    if (await isAccessoryParent(ctx, a.orgId, child.id)) throw new ConvexError(`${child.assetTag} has accessories of its own. Detach them first, or attach a different asset.`);

    // Atomic: the guards above + this patch are one transaction (closes the TOCTOU).
    // Child physically lives with the parent → inherit its location.
    await ctx.db.patch(child._id, {
      parentAssetId: a.parentAssetId,
      ...(parent.locationId ? { locationId: parent.locationId } : {}),
      ...(a.notes ? { notes: a.notes } : {}),
      updatedAt: a.now,
    });
    await logAccessory(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, parentId: parent.id, entityName: parent.assetTag, summary: `Attached accessory ${child.assetTag} to ${parent.assetTag}`, details: { accessory: { childAssetId: child.id, childTag: child.assetTag } } });
    return { id: child.id };
  },
});

export const addBulkNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(), parentAssetId: v.string(), orgId: v.string(), bulkAssetId: v.string(),
    quantity: v.number(), allocationMode: enums.AccessoryAllocationMode, notes: v.optional(v.string()),
    now: v.number(), actor: actorValidator, auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "assetAccessory");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "asset", "update");
    const actor = await resolveActor(ctx, a.actor);
    if (!Number.isInteger(a.quantity) || a.quantity < 1) throw new ConvexError("Quantity must be a whole number of at least 1");

    const parent = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", a.parentAssetId)).first();
    if (!parent || parent.organizationId !== a.orgId) throw new ConvexError("Asset not found");
    if (parent.parentAssetId) throw new ConvexError("This asset is itself an accessory. Attach accessories to a top-level asset instead.");

    const bulkAsset = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.bulkAssetId)).first();
    if (!bulkAsset || bulkAsset.organizationId !== a.orgId) throw new ConvexError("Bulk asset not found");

    const dup = await ctx.db.query("assetBulkChildren").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Accessory already exists");

    const siblings = (await ctx.db.query("assetBulkChildren").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect()) // r9.8-ok: reviewed, accepted R-9.8 tradeoff over the org set (aggregation/enrichment)
      .filter((c) => c.parentAssetId === a.parentAssetId);
    const sortOrder = siblings.reduce((max, c) => Math.max(max, c.sortOrder ?? -1), -1) + 1;

    // DEDICATED draws from the shared pool NOW (atomic + throws on insufficient stock).
    if (a.allocationMode === "DEDICATED") {
      await adjustBulkAvailability(ctx, a.orgId, [{ bulkAssetId: a.bulkAssetId, delta: -a.quantity }]);
    }
    await ctx.db.insert("assetBulkChildren", {
      id: a.id, organizationId: a.orgId, parentAssetId: a.parentAssetId, bulkAssetId: a.bulkAssetId,
      quantity: a.quantity, allocationMode: a.allocationMode, sortOrder, notes: a.notes || undefined, addedAt: a.now, addedById: actor.userId,
    });
    await logAccessory(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, parentId: parent.id, entityName: parent.assetTag, summary: `Attached ${a.quantity}× ${bulkAsset.assetTag} to ${parent.assetTag} (${a.allocationMode})`, details: { accessory: { bulkAssetId: bulkAsset.id, quantity: a.quantity, allocationMode: a.allocationMode } } });
    return { id: a.id };
  },
});

export const removeSerializedNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { parentAssetId: v.string(), orgId: v.string(), childAssetId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "assetAccessory");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "asset", "update");
    const actor = await resolveActor(ctx, a.actor);

    const child = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", a.childAssetId)).first();
    if (!child || child.organizationId !== a.orgId || child.parentAssetId !== a.parentAssetId) throw new ConvexError("That accessory is not attached to this asset.");
    if ((child.status ?? "AVAILABLE") !== "AVAILABLE") throw new ConvexError(`${child.assetTag} is ${(child.status ?? "unavailable").replace("_", " ").toLowerCase()} — return it before detaching.`);

    await ctx.db.patch(child._id, { parentAssetId: undefined, updatedAt: a.now });
    await logAccessory(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, parentId: a.parentAssetId, entityName: child.assetTag, summary: `Detached accessory ${child.assetTag}`, details: { accessory: { childAssetId: a.childAssetId } } });
    return { ok: true };
  },
});

export const removeBulkNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { parentAssetId: v.string(), orgId: v.string(), bulkChildId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "assetAccessory");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "asset", "update");
    const actor = await resolveActor(ctx, a.actor);

    const bulkChild = await ctx.db.query("assetBulkChildren").withIndex("by_cuid", (q) => q.eq("id", a.bulkChildId)).first();
    if (!bulkChild || bulkChild.organizationId !== a.orgId || bulkChild.parentAssetId !== a.parentAssetId) throw new ConvexError("That accessory is not attached to this asset.");
    // by_cuid is global — only use the bulk asset's tag in the audit if it's THIS org's
    // (the DEDICATED restore below is already org-checked inside adjustBulkAvailability).
    const bulkAsset = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", bulkChild.bulkAssetId)).first();
    const bulkTag = bulkAsset && bulkAsset.organizationId === a.orgId ? bulkAsset.assetTag : bulkChild.bulkAssetId;

    // Restore DEDICATED stock to the shared pool (atomic with the delete below).
    if (bulkChild.allocationMode === "DEDICATED") {
      await adjustBulkAvailability(ctx, a.orgId, [{ bulkAssetId: bulkChild.bulkAssetId, delta: bulkChild.quantity }]);
    }
    await ctx.db.delete(bulkChild._id);
    await logAccessory(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, parentId: a.parentAssetId, entityName: bulkTag, summary: `Detached ${bulkChild.quantity}× ${bulkTag}`, details: { accessory: { bulkAssetId: bulkChild.bulkAssetId, quantity: bulkChild.quantity } } });
    return { ok: true };
  },
});
