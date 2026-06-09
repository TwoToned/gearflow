import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Kit (Convex table "kits"). GENERATED — Phase 2.
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
      .query("kits")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
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
  handler: async (ctx, args) => await ctx.db.insert("kits", args),
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
    const doc = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("kits not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("kits not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
