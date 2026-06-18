import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for ModelBulkAccessory (Convex table "modelBulkAccessories"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("modelBulkAccessories")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("modelBulkAccessories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    bulkAssetId: v.string(),
    quantity: v.number(),
    sortOrder: v.optional(v.number()),
    notes: v.optional(v.string()),
    addedAt: v.optional(v.number()),
    addedById: v.string(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("modelBulkAccessories", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    bulkAssetId: v.string(),
    quantity: v.number(),
    sortOrder: v.optional(v.number()),
    notes: v.optional(v.string()),
    addedAt: v.optional(v.number()),
    addedById: v.string(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("modelBulkAccessories").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("modelBulkAccessories", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      quantity: v.optional(v.number()),
      sortOrder: v.optional(v.number()),
      notes: v.optional(v.string()),
      addedAt: v.optional(v.number()),
      addedById: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("modelBulkAccessories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("modelBulkAccessories not found: " + id);
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
    const doc = await ctx.db.query("modelBulkAccessories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("modelBulkAccessories not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

/**
 * All accessories for a model + org, sorted by sortOrder, with the bulk asset's
 * modelId and assetTag attached (N+1 but bounded — typically < 20 per model).
 */
export const listByModelId = query({
  args: { modelId: v.string(), organizationId: v.string() },
  handler: async (ctx, { modelId, organizationId }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("modelBulkAccessories")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .filter((q) => q.eq(q.field("organizationId"), organizationId))
      .collect();
    rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return await Promise.all(
      rows.map(async (row) => {
        const bulkAsset = await ctx.db
          .query("bulkAssets")
          .withIndex("by_cuid", (q) => q.eq("id", row.bulkAssetId))
          .unique();
        return { ...row, bulkAssetModelId: bulkAsset?.modelId ?? null, bulkAssetAssetTag: bulkAsset?.assetTag ?? null };
      }),
    );
  },
});

/** Check for an existing (modelId, bulkAssetId) pair within an org. */
export const getByModelAndBulkAsset = query({
  args: { modelId: v.string(), bulkAssetId: v.string(), organizationId: v.string() },
  handler: async (ctx, { modelId, bulkAssetId, organizationId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("modelBulkAccessories")
      .withIndex("by_modelId_bulkAssetId", (q) => q.eq("modelId", modelId).eq("bulkAssetId", bulkAssetId))
      .filter((q) => q.eq(q.field("organizationId"), organizationId))
      .first();
  },
});
