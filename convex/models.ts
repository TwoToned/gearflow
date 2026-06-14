import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Model (Convex table "models"). GENERATED — Phase 2/5.
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
      .query("models")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("models", args);
  },
});

export const createIfMissing = mutation({
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("models", args);
    return { _id, created: true };
  },
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
    await requireService(ctx);
    const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("models not found: " + id);
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
    const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("models not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
