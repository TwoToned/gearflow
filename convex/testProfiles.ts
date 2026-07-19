import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for TestProfile (Convex table "testProfiles"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("testProfiles")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded per-org config/catalog set
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Resolve the best test profile for a test-tag asset (browser-direct replacement
 * for resolveTestProfile). Cascade: asset.testProfileId → model.defaultTestProfileId
 * → org default for class+type → any active for class+type → null. Every hop is
 * org re-checked (all lookups use the GLOBAL by_cuid index). Returns null when the
 * asset isn't in this org OR no profile matches. See FEATUREDOCS/54.
 */
export const resolveForAsset = query({
  args: { orgId: v.string(), testTagAssetId: v.string() },
  handler: async (ctx, { orgId, testTagAssetId }) => {
    await requireOrgRead(ctx, orgId);
    const orgProfile = async (id: string) => {
      const p = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      return p && p.organizationId === orgId ? p : null;
    };

    const asset = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", testTagAssetId)).first();
    if (!asset || asset.organizationId !== orgId) return null;

    // 1. Asset-level profile.
    if (asset.testProfileId) {
      const own = await orgProfile(asset.testProfileId);
      if (own) return own;
    }
    // 2. Model default (testTagAsset.assetId → asset.modelId → model.defaultTestProfileId).
    if (asset.assetId) {
      const linked = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", asset.assetId!)).first();
      if (linked && linked.organizationId === orgId && linked.modelId) {
        const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", linked.modelId!)).first();
        if (model && model.organizationId === orgId && model.defaultTestProfileId) {
          const modelProfile = await orgProfile(model.defaultTestProfileId);
          if (modelProfile) return modelProfile;
        }
      }
    }
    // 3/4. Org default, then any active, for the asset's class+type.
    const orgProfiles = (await ctx.db.query("testProfiles").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect()); // r9.8-ok: bounded per-org config/catalog set
    const matches = (p: (typeof orgProfiles)[number]) => p.equipmentClass === asset.equipmentClass && p.applianceType === asset.applianceType;
    return (
      orgProfiles.find((p) => matches(p) && p.isDefault === true && p.isActive === true) ??
      orgProfiles.find((p) => matches(p) && p.isActive === true) ??
      null
    );
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    equipmentClass: v.optional(enums.EquipmentClass),
    applianceType: v.optional(enums.ApplianceType),
    visualChecks: v.any(),
    electricalTests: v.any(),
    thresholds: v.any(),
    requiresSubTests: v.optional(v.boolean()),
    defaultSubTestCount: v.optional(v.number()),
    subTestLabel: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("testProfiles", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    equipmentClass: v.optional(enums.EquipmentClass),
    applianceType: v.optional(enums.ApplianceType),
    visualChecks: v.any(),
    electricalTests: v.any(),
    thresholds: v.any(),
    requiresSubTests: v.optional(v.boolean()),
    defaultSubTestCount: v.optional(v.number()),
    subTestLabel: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("testProfiles", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      equipmentClass: v.optional(enums.EquipmentClass),
      applianceType: v.optional(enums.ApplianceType),
      visualChecks: v.optional(v.any()),
      electricalTests: v.optional(v.any()),
      thresholds: v.optional(v.any()),
      requiresSubTests: v.optional(v.boolean()),
      defaultSubTestCount: v.optional(v.number()),
      subTestLabel: v.optional(v.string()),
      isDefault: v.optional(v.boolean()),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("testProfiles not found: " + id);
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
    const doc = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("testProfiles not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
