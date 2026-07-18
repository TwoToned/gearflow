import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { bumpCountersForTable } from "./lib/counters";
import { reserveAssetTagCounter } from "./lib/assetTagCounter";
import { assertRefInOrg } from "./lib/orgRef";
import * as enums from "./lib/validators";

/**
 * Native BULK-ASSET write mutations (Phase 3 browser-direct — replaces
 * createBulkAsset/updateBulkAsset/deleteBulkAsset/archiveBulkAsset;
 * updateBulkAssetNotes was dead and is dropped). Each runs the 4 guards + per-row
 * org re-check + atomic audit + sharded-counter bump (parity with the service
 * create/patch/remove which bump). The form runs bulkAssetSchema; validateBulk
 * re-checks server-side (the mutation is the boundary).
 *
 * Invariants folded in:
 *  - create: dup-tag guard (by_organizationId_assetTag) + dup-id guard (by_cuid) +
 *    reserveAssetTagCounter(1) advance (parity — create used a form tag but bumped
 *    the counter by 1).
 *  - update: dup-tag guard only when the tag changed; availableQuantity recomputed
 *    from the total delta (max(0, prev + (newTotal - prevTotal))); purchasePrice/
 *    location/notes cleared when blank.
 *  - delete: reference guards (project line items → kit membership block).
 *  - archive: soft (isActive=false, status=RETIRED).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const bulkFields = {
  modelId: v.string(),
  assetTag: v.string(),
  totalQuantity: v.optional(v.number()),
  purchasePricePerUnit: v.optional(v.number()),
  locationId: v.optional(v.string()),
  status: v.optional(enums.BulkAssetStatus),
  notes: v.optional(v.string()),
  isActive: v.optional(v.boolean()),
  tags: v.optional(v.array(v.string())),
};

type BulkArgs = {
  modelId: string; assetTag: string; totalQuantity?: number; purchasePricePerUnit?: number;
  locationId?: string; status?: string; notes?: string; isActive?: boolean; tags?: string[];
};

function validateBulk(a: BulkArgs) {
  if (!a.modelId || a.modelId.length < 1) throw new ConvexError("Model is required");
  if (!a.assetTag || a.assetTag.length < 1) throw new ConvexError("Asset tag is required");
  if (a.assetTag.length > 50) throw new ConvexError("Asset tag is too long");
  const q = a.totalQuantity ?? 0;
  if (!Number.isInteger(q) || q < 0) throw new ConvexError("Quantity must be 0 or more");
  if (a.purchasePricePerUnit != null && (!Number.isFinite(a.purchasePricePerUnit) || a.purchasePricePerUnit < 0)) {
    throw new ConvexError("Purchase price must be zero or positive");
  }
  if (a.notes && a.notes.length > 2000) throw new ConvexError("Notes are too long");
}

async function logBulk(ctx: MutationCtx, a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; id: string; assetTag: string; summary: string; details?: unknown }) {
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.orgId, action: a.action, entityType: "bulkAsset", entityId: a.id,
    entityName: a.assetTag, userId: a.actor.userId, userName: a.actor.userName, summary: a.summary, details: a.details, createdAt: a.now,
  });
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...bulkFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "bulkAsset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "bulkAsset", "create");
    const actor = await resolveActor(ctx, a.actor);
    validateBulk(a);

    const dupId = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dupId) throw new ConvexError("Bulk asset already exists");
    const dupTag = await ctx.db.query("bulkAssets")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", a.orgId).eq("assetTag", a.assetTag)).first();
    if (dupTag) throw new ConvexError(`Asset tag "${a.assetTag}" already exists.`);

    // Org-validate client-supplied FKs (by_cuid is GLOBAL — cross-org refs leak).
    await assertRefInOrg(ctx, "models", a.modelId, a.orgId);
    if (a.locationId) await assertRefInOrg(ctx, "locations", a.locationId, a.orgId);

    const total = a.totalQuantity ?? 0;
    const doc = {
      id: a.id,
      organizationId: a.orgId,
      modelId: a.modelId,
      assetTag: a.assetTag,
      totalQuantity: total,
      availableQuantity: total,
      purchasePricePerUnit: a.purchasePricePerUnit != null ? Number(a.purchasePricePerUnit) : undefined,
      locationId: a.locationId || undefined,
      status: (a.status as "ACTIVE") ?? "ACTIVE",
      notes: a.notes || undefined,
      isActive: a.isActive ?? true,
      tags: a.tags || [],
      createdAt: a.now,
      updatedAt: a.now,
    };
    await ctx.db.insert("bulkAssets", doc);
    await bumpCountersForTable(ctx, "bulkAssets", null, doc);
    await reserveAssetTagCounter(ctx, a.orgId, 1, a.now); // advance counter (parity)

    await logBulk(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, assetTag: a.assetTag,
      summary: `Created bulk asset ${a.assetTag}`, details: { created: { assetTag: a.assetTag, totalQuantity: total } },
    });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...bulkFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "bulkAsset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "bulkAsset", "update");
    const actor = await resolveActor(ctx, a.actor);
    validateBulk(a);

    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Bulk asset not found");

    if (a.assetTag !== doc.assetTag) {
      const dup = await ctx.db.query("bulkAssets")
        .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", a.orgId).eq("assetTag", a.assetTag)).first();
      if (dup && dup.id !== a.id) throw new ConvexError(`Asset tag "${a.assetTag}" already exists.`);
    }

    // Org-validate client-supplied FKs (by_cuid is GLOBAL — cross-org refs leak).
    await assertRefInOrg(ctx, "models", a.modelId, a.orgId);
    if (a.locationId) await assertRefInOrg(ctx, "locations", a.locationId, a.orgId);

    // Availability recompute from the total delta (parity).
    const prevTotal = doc.totalQuantity ?? 0;
    const prevAvail = doc.availableQuantity ?? 0;
    const newTotal = a.totalQuantity ?? 0;
    const newAvailable = Math.max(0, prevAvail + (newTotal - prevTotal));

    const { _id, _creationTime, ...rest } = doc;
    const merged: Record<string, unknown> = {
      ...rest,
      modelId: a.modelId,
      assetTag: a.assetTag,
      totalQuantity: newTotal,
      availableQuantity: newAvailable,
      status: (a.status as "ACTIVE") ?? "ACTIVE",
      isActive: a.isActive ?? true,
      tags: a.tags ?? [],
      updatedAt: a.now,
    };
    if (a.purchasePricePerUnit != null) merged.purchasePricePerUnit = Number(a.purchasePricePerUnit);
    else delete merged.purchasePricePerUnit;
    if (a.locationId) merged.locationId = a.locationId;
    else delete merged.locationId;
    if (a.notes) merged.notes = a.notes;
    else delete merged.notes;

    await ctx.db.replace(doc._id, merged as typeof rest);
    await bumpCountersForTable(ctx, "bulkAssets", doc, merged);

    await logBulk(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, assetTag: a.assetTag, summary: `Updated bulk asset ${a.assetTag}` });
    return { id: a.id };
  },
});

export const deleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "bulkAsset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "bulkAsset", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Bulk asset not found");

    // Reference guards (org-filtered — by_bulkAssetId is GLOBAL).
    const refLines = (await ctx.db.query("projectLineItems").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", a.id)).collect())
      .filter((li) => li.organizationId === a.orgId);
    if (refLines.length > 0) throw new ConvexError("Cannot delete — this bulk asset is referenced by project line items. Archive it instead.");
    const kitRefs = (await ctx.db.query("kitBulkItems").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", a.id)).collect())
      .filter((ki) => ki.organizationId === a.orgId);
    if (kitRefs.length > 0) throw new ConvexError("Cannot delete — this bulk asset is part of a kit. Remove it from the kit first.");

    await ctx.db.delete(doc._id);
    await bumpCountersForTable(ctx, "bulkAssets", doc, null);

    await logBulk(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "DELETE", id: a.id, assetTag: doc.assetTag, summary: `Deleted bulk asset ${doc.assetTag}`, details: { deleted: { assetTag: doc.assetTag } } });
    return { id: a.id };
  },
});

// Archive is no-audit (parity — the old archiveBulkAsset only patched, no logActivity),
// so resolveActor is omitted; the other 3 guards stay.
export const archiveNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "bulkAsset");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "bulkAsset", "update");

    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Bulk asset not found");

    const set = { isActive: false, status: "RETIRED" as const, updatedAt: a.now };
    await ctx.db.patch(doc._id, set);
    await bumpCountersForTable(ctx, "bulkAssets", doc, { ...doc, ...set });
    return { id: a.id };
  },
});
