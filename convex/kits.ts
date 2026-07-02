import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import { adjustBulkAvailability } from "./lib/inventory";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Kit (Convex table "kits"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("kits")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Batch point-read kits by cuid, scoped to one org — lets a composite read only
 * the kits its line items reference (e.g. buildProjectEquipmentTree) instead of
 * getKitsByOrg (every kit in the org). Cross-org ids are dropped.
 */
export const listByIds = query({
  args: { orgId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { orgId, ids }) => {
    await requireOrgRead(ctx, orgId);
    const unique = [...new Set(ids)];
    if (unique.length > 1000) throw new ConvexError("kits.listByIds: too many ids (max 1000)");
    const docs = await Promise.all(
      unique.map((id) => ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    return docs.filter((d): d is NonNullable<typeof d> => d !== null && d.organizationId === orgId);
  },
});

export const getByAssetTag = query({
  args: { organizationId: v.string(), assetTag: v.string() },
  handler: async (ctx, { organizationId, assetTag }) => {
    await requireOrgRead(ctx, organizationId);
    return await ctx.db
      .query("kits")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", organizationId).eq("assetTag", assetTag))
      .unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assetTag: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    status: v.optional(enums.KitStatus),
    condition: v.optional(enums.AssetCondition),
    locationId: v.optional(v.string()),
    weight: v.optional(v.number()),
    caseType: v.optional(v.string()),
    caseDimensions: v.optional(v.string()),
    image: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    notes: v.optional(v.string()),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    customFieldValues: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    checkMode: v.optional(enums.KitCheckMode),
    isPrep: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("kits", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assetTag: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    status: v.optional(enums.KitStatus),
    condition: v.optional(enums.AssetCondition),
    locationId: v.optional(v.string()),
    weight: v.optional(v.number()),
    caseType: v.optional(v.string()),
    caseDimensions: v.optional(v.string()),
    image: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    notes: v.optional(v.string()),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    customFieldValues: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    checkMode: v.optional(enums.KitCheckMode),
    isPrep: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("kits", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      assetTag: v.optional(v.string()),
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      categoryId: v.optional(v.string()),
      status: v.optional(enums.KitStatus),
      condition: v.optional(enums.AssetCondition),
      locationId: v.optional(v.string()),
      weight: v.optional(v.number()),
      caseType: v.optional(v.string()),
      caseDimensions: v.optional(v.string()),
      image: v.optional(v.string()),
      images: v.optional(v.array(v.string())),
      barcode: v.optional(v.string()),
      qrCode: v.optional(v.string()),
      notes: v.optional(v.string()),
      purchaseDate: v.optional(v.number()),
      purchasePrice: v.optional(v.number()),
      customFieldValues: v.optional(v.any()),
      tags: v.optional(v.array(v.string())),
      checkMode: v.optional(enums.KitCheckMode),
      isPrep: v.optional(v.boolean()),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("kits not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("kits not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ── CUSTOM (Phase C — core mega-flip) — re-add on regen ──────────────────────
// Kit composition: each Prisma $transaction (member write + asset/bulk status)
// becomes one atomic Convex mutation. The asset-availability guards (asset must
// be AVAILABLE / unkitted) live INSIDE the mutation so two kits can't grab the
// same asset (the check + write are serializable; OCC retries the loser).
// ─────────────────────────────────────────────────────────────────────────────

async function getKitGuarded(ctx: MutationCtx, kitId: string, organizationId: string) {
  const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", kitId)).unique();
  if (!kit || kit.organizationId !== organizationId) throw new ConvexError("Kit not found");
  if (kit.status !== "AVAILABLE") throw new ConvexError("Items can only be added to/removed from AVAILABLE kits");
  return kit;
}

/** Set kitId + the kit's location on an asset (clearing location if the kit has none). */
async function assignAssetToKit(
  ctx: MutationCtx,
  asset: NonNullable<Awaited<ReturnType<typeof getAssetDoc>>>,
  kitId: string,
  kitLocationId: string | undefined,
  now: number,
) {
  if (kitLocationId != null) {
    await ctx.db.patch(asset._id, { kitId, locationId: kitLocationId, updatedAt: now });
  } else {
    const { _id, _creationTime, locationId: _l, ...rest } = asset;
    await ctx.db.replace(_id, { ...rest, kitId, updatedAt: now });
  }
}

/** Release an asset back to inventory (kitId cleared, status AVAILABLE). */
async function releaseAsset(ctx: MutationCtx, assetId: string, now: number) {
  const asset = await getAssetDoc(ctx, assetId);
  if (!asset) return;
  const { _id, _creationTime, kitId: _k, ...rest } = asset;
  await ctx.db.replace(_id, { ...rest, status: "AVAILABLE", updatedAt: now });
}

async function getAssetDoc(ctx: MutationCtx, id: string) {
  return await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}

export const addSerializedItem = mutation({
  args: {
    organizationId: v.string(),
    kitId: v.string(),
    assetId: v.string(),
    position: v.optional(v.string()),
    notes: v.optional(v.string()),
    addedById: v.string(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kit = await getKitGuarded(ctx, a.kitId, a.organizationId);
    const asset = await getAssetDoc(ctx, a.assetId);
    if (!asset || asset.organizationId !== a.organizationId) throw new ConvexError("Asset not found");
    if (asset.status !== "AVAILABLE") throw new ConvexError("Asset is not AVAILABLE");
    if (asset.kitId) throw new ConvexError("Asset is already assigned to another kit");
    if (asset.parentAssetId) throw new ConvexError("Asset is an accessory of another asset — detach it first");
    const id = createId();
    await ctx.db.insert("kitSerializedItems", {
      id, organizationId: a.organizationId, kitId: a.kitId, assetId: a.assetId,
      position: a.position, notes: a.notes, addedById: a.addedById, addedAt: a.now,
    });
    await assignAssetToKit(ctx, asset, a.kitId, kit.locationId, a.now);
    return { id };
  },
});

export const addSerializedItems = mutation({
  args: {
    organizationId: v.string(),
    kitId: v.string(),
    items: v.array(v.object({ assetId: v.string(), position: v.optional(v.string()) })),
    addedById: v.string(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kit = await getKitGuarded(ctx, a.kitId, a.organizationId);
    const created: string[] = [];
    for (const it of a.items) {
      const asset = await getAssetDoc(ctx, it.assetId);
      if (!asset || asset.organizationId !== a.organizationId) throw new ConvexError("Asset not found");
      if (asset.status !== "AVAILABLE") throw new ConvexError(`Asset ${asset.assetTag} is not AVAILABLE`);
      if (asset.kitId) throw new ConvexError(`Asset ${asset.assetTag} is already in another kit`);
      if (asset.parentAssetId) throw new ConvexError(`Asset ${asset.assetTag} is an accessory — detach it first`);
      const id = createId();
      await ctx.db.insert("kitSerializedItems", {
        id, organizationId: a.organizationId, kitId: a.kitId, assetId: it.assetId,
        position: it.position, addedById: a.addedById, addedAt: a.now,
      });
      await assignAssetToKit(ctx, asset, a.kitId, kit.locationId, a.now);
      created.push(id);
    }
    return { ids: created };
  },
});

export const removeSerializedItem = mutation({
  args: { organizationId: v.string(), kitId: v.string(), assetId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    await getKitGuarded(ctx, a.kitId, a.organizationId);
    const member = await ctx.db
      .query("kitSerializedItems")
      .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", a.organizationId).eq("assetId", a.assetId))
      .unique();
    if (!member) throw new ConvexError("Kit item not found");
    await ctx.db.delete(member._id);
    await releaseAsset(ctx, a.assetId, a.now);
    return { id: member.id };
  },
});

export const addBulkItem = mutation({
  args: {
    organizationId: v.string(),
    kitId: v.string(),
    bulkAssetId: v.string(),
    quantity: v.number(),
    position: v.optional(v.string()),
    notes: v.optional(v.string()),
    addedById: v.string(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    await getKitGuarded(ctx, a.kitId, a.organizationId);
    const id = createId();
    await ctx.db.insert("kitBulkItems", {
      id, organizationId: a.organizationId, kitId: a.kitId, bulkAssetId: a.bulkAssetId,
      quantity: a.quantity, position: a.position, notes: a.notes, addedById: a.addedById, addedAt: a.now,
    });
    // Guarded decrement (throws + rolls back if insufficient).
    await adjustBulkAvailability(ctx, a.organizationId, [{ bulkAssetId: a.bulkAssetId, delta: -a.quantity }]);
    return { id };
  },
});

export const removeBulkItem = mutation({
  args: { organizationId: v.string(), kitId: v.string(), bulkItemId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    await getKitGuarded(ctx, a.kitId, a.organizationId);
    const member = await ctx.db.query("kitBulkItems").withIndex("by_cuid", (q) => q.eq("id", a.bulkItemId)).unique();
    if (!member || member.organizationId !== a.organizationId) throw new ConvexError("Bulk item not found");
    if (member.kitId !== a.kitId) throw new ConvexError("Bulk item does not belong to this kit");
    await ctx.db.delete(member._id);
    await adjustBulkAvailability(ctx, a.organizationId, [{ bulkAssetId: member.bulkAssetId, delta: member.quantity }]);
    return { bulkAssetId: member.bulkAssetId };
  },
});

/** Release all members + (archive: soft-delete / delete: hard-delete) the kit, atomically. */
export async function releaseKitMembers(ctx: MutationCtx, kitId: string, organizationId: string, now: number) {
  const serialized = await ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect();
  for (const m of serialized) {
    await releaseAsset(ctx, m.assetId, now);
    await ctx.db.delete(m._id);
  }
  const bulk = await ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect();
  for (const m of bulk) {
    await adjustBulkAvailability(ctx, organizationId, [{ bulkAssetId: m.bulkAssetId, delta: m.quantity }]);
    await ctx.db.delete(m._id);
  }
}

export const archiveCascade = mutation({
  args: { organizationId: v.string(), kitId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", a.kitId)).unique();
    if (!kit || kit.organizationId !== a.organizationId) throw new ConvexError("Kit not found");
    if (kit.status !== "AVAILABLE") throw new ConvexError("Only AVAILABLE kits can be archived");
    await releaseKitMembers(ctx, a.kitId, a.organizationId, a.now);
    await ctx.db.patch(kit._id, { isActive: false, status: "RETIRED", updatedAt: a.now });
    return { id: a.kitId };
  },
});

export const deleteCascade = mutation({
  args: { organizationId: v.string(), kitId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", a.kitId)).unique();
    if (!kit || kit.organizationId !== a.organizationId) throw new ConvexError("Kit not found");
    if (kit.status !== "AVAILABLE") throw new ConvexError("Only AVAILABLE kits can be deleted");
    await releaseKitMembers(ctx, a.kitId, a.organizationId, a.now);
    await ctx.db.delete(kit._id);
    return { id: a.kitId };
  },
});
