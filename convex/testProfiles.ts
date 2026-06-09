import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for TestProfile (Convex table "testProfiles"). GENERATED — Phase 2.
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
      .query("testProfiles")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
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
  handler: async (ctx, args) => await ctx.db.insert("testProfiles", args),
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
    const doc = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("testProfiles not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("testProfiles not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
