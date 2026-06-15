import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Asset (Convex table "assets"). GENERATED — Phase 2/5.
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
      .query("assets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const listByModel = query({
  args: { modelId: v.string(), orgId: v.string() },
  handler: async (ctx, { modelId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("assets")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .collect();
  },
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("assets", args);
  },
});

export const createIfMissing = mutation({
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("assets", args);
    return { _id, created: true };
  },
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
    await requireService(ctx);
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assets not found: " + id);
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
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assets not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
