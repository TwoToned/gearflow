import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Model (Convex table "models"). GENERATED — Phase 2.
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
      .query("models")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    manufacturer: v.optional(v.string()),
    modelNumber: v.optional(v.string()),
    sku: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    description: v.optional(v.string()),
    image: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    manuals: v.optional(v.array(v.string())),
    specifications: v.optional(v.any()),
    customFields: v.optional(v.any()),
    defaultRentalPrice: v.optional(v.number()),
    dailyRate: v.optional(v.number()),
    weeklyRate: v.optional(v.number()),
    monthlyRate: v.optional(v.number()),
    defaultPurchasePrice: v.optional(v.number()),
    replacementCost: v.optional(v.number()),
    weight: v.optional(v.number()),
    powerDraw: v.optional(v.number()),
    requiresTestAndTag: v.optional(v.boolean()),
    testAndTagIntervalDays: v.optional(v.number()),
    defaultEquipmentClass: v.optional(enums.EquipmentClass),
    defaultApplianceType: v.optional(enums.ApplianceType),
    defaultTestProfileId: v.optional(v.string()),
    maintenanceIntervalDays: v.optional(v.number()),
    assetType: v.optional(enums.AssetType),
    barcodeLabelTemplate: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("models", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      manufacturer: v.optional(v.string()),
      modelNumber: v.optional(v.string()),
      sku: v.optional(v.string()),
      categoryId: v.optional(v.string()),
      description: v.optional(v.string()),
      image: v.optional(v.string()),
      images: v.optional(v.array(v.string())),
      manuals: v.optional(v.array(v.string())),
      specifications: v.optional(v.any()),
      customFields: v.optional(v.any()),
      defaultRentalPrice: v.optional(v.number()),
      dailyRate: v.optional(v.number()),
      weeklyRate: v.optional(v.number()),
      monthlyRate: v.optional(v.number()),
      defaultPurchasePrice: v.optional(v.number()),
      replacementCost: v.optional(v.number()),
      weight: v.optional(v.number()),
      powerDraw: v.optional(v.number()),
      requiresTestAndTag: v.optional(v.boolean()),
      testAndTagIntervalDays: v.optional(v.number()),
      defaultEquipmentClass: v.optional(enums.EquipmentClass),
      defaultApplianceType: v.optional(enums.ApplianceType),
      defaultTestProfileId: v.optional(v.string()),
      maintenanceIntervalDays: v.optional(v.number()),
      assetType: v.optional(enums.AssetType),
      barcodeLabelTemplate: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("models not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("models not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
