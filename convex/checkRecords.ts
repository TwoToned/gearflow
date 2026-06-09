import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CheckRecord (Convex table "checkRecords"). GENERATED — Phase 2.
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
      .query("checkRecords")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("checkRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    context: enums.CheckContext,
    lineItemId: v.optional(v.string()),
    lineItemUnitId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    checkItemId: v.string(),
    checkItemLabelSnapshot: v.string(),
    checkItemTypeSnapshot: enums.CheckItemType,
    result: enums.CheckResult,
    value: v.optional(v.string()),
    notes: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
    performedById: v.string(),
    performedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("checkRecords", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      context: v.optional(enums.CheckContext),
      lineItemId: v.optional(v.string()),
      lineItemUnitId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      kitId: v.optional(v.string()),
      checkItemId: v.optional(v.string()),
      checkItemLabelSnapshot: v.optional(v.string()),
      checkItemTypeSnapshot: v.optional(enums.CheckItemType),
      result: v.optional(enums.CheckResult),
      value: v.optional(v.string()),
      notes: v.optional(v.string()),
      photos: v.optional(v.array(v.string())),
      performedById: v.optional(v.string()),
      performedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("checkRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("checkRecords not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("checkRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("checkRecords not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
