import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Asset (Convex table "assets"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) =>
    await ctx.db
      .query("assets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    serialNumber: v.optional(v.string()),
    customName: v.optional(v.string()),
    status: v.optional(enums.AssetStatus),
    condition: v.optional(enums.AssetCondition),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    purchaseSupplier: v.optional(v.string()),
    supplierId: v.optional(v.string()),
    purchaseOrderNumber: v.optional(v.string()),
    supplierOrderId: v.optional(v.string()),
    warrantyExpiry: v.optional(v.number()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.string()),
    customFieldValues: v.optional(v.any()),
    lastTestAndTagDate: v.optional(v.number()),
    nextTestAndTagDate: v.optional(v.number()),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    kitId: v.optional(v.string()),
    parentAssetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => await ctx.db.insert("assets", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      assetTag: v.optional(v.string()),
      serialNumber: v.optional(v.string()),
      customName: v.optional(v.string()),
      status: v.optional(enums.AssetStatus),
      condition: v.optional(enums.AssetCondition),
      purchaseDate: v.optional(v.number()),
      purchasePrice: v.optional(v.number()),
      purchaseSupplier: v.optional(v.string()),
      supplierId: v.optional(v.string()),
      purchaseOrderNumber: v.optional(v.string()),
      supplierOrderId: v.optional(v.string()),
      warrantyExpiry: v.optional(v.number()),
      notes: v.optional(v.string()),
      locationId: v.optional(v.string()),
      customFieldValues: v.optional(v.any()),
      lastTestAndTagDate: v.optional(v.number()),
      nextTestAndTagDate: v.optional(v.number()),
      barcode: v.optional(v.string()),
      qrCode: v.optional(v.string()),
      images: v.optional(v.array(v.string())),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      kitId: v.optional(v.string()),
      parentAssetId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("assets not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("assets not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
