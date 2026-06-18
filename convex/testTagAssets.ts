import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for TestTagAsset (Convex table "testTagAssets"). GENERATED — Phase 2/5.
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
      .query("testTagAssets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * Look up a single test tag asset by its human-facing `testTagId` within an org
 * (the scan / lookup flow). Uses the non-unique `by_organizationId_testTagId`
 * index, so return `.first()` — duplicates are possible across the dual-write
 * boundary and `.unique()` would throw.
 */
export const getByTestTagId = query({
  args: { orgId: v.string(), testTagId: v.string() },
  handler: async (ctx, { orgId, testTagId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId_testTagId", (q) =>
        q.eq("organizationId", orgId).eq("testTagId", testTagId),
      )
      .first();
  },
});

/**
 * Alias of {@link getByTestTagId} kept for the scan-lookup consumer (Phase A).
 * Same `.first()`-not-`.unique()` safety on the non-unique dual-write index.
 */
export const getByOrgTestTagId = query({
  args: { orgId: v.string(), testTagId: v.string() },
  handler: async (ctx, { orgId, testTagId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId_testTagId", (q) =>
        q.eq("organizationId", orgId).eq("testTagId", testTagId),
      )
      .first();
  },
});


export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    testTagId: v.string(),
    description: v.string(),
    equipmentClass: v.optional(enums.EquipmentClass),
    applianceType: v.optional(enums.ApplianceType),
    make: v.optional(v.string()),
    modelName: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    location: v.optional(v.string()),
    testIntervalMonths: v.optional(v.number()),
    status: v.optional(enums.TestTagStatus),
    lastTestDate: v.optional(v.number()),
    nextDueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    testProfileId: v.optional(v.string()),
    outletCount: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("testTagAssets", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    testTagId: v.string(),
    description: v.string(),
    equipmentClass: v.optional(enums.EquipmentClass),
    applianceType: v.optional(enums.ApplianceType),
    make: v.optional(v.string()),
    modelName: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    location: v.optional(v.string()),
    testIntervalMonths: v.optional(v.number()),
    status: v.optional(enums.TestTagStatus),
    lastTestDate: v.optional(v.number()),
    nextDueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    testProfileId: v.optional(v.string()),
    outletCount: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("testTagAssets", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      testTagId: v.optional(v.string()),
      description: v.optional(v.string()),
      equipmentClass: v.optional(enums.EquipmentClass),
      applianceType: v.optional(enums.ApplianceType),
      make: v.optional(v.string()),
      modelName: v.optional(v.string()),
      serialNumber: v.optional(v.string()),
      location: v.optional(v.string()),
      testIntervalMonths: v.optional(v.number()),
      status: v.optional(enums.TestTagStatus),
      lastTestDate: v.optional(v.number()),
      nextDueDate: v.optional(v.number()),
      notes: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      testProfileId: v.optional(v.string()),
      outletCount: v.optional(v.number()),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("testTagAssets not found: " + id);
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
    const doc = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("testTagAssets not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
