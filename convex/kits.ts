import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
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
