import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Thin CRUD for MaintenanceRecordAsset (Convex table "maintenanceRecordAssets"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { maintenanceRecordId: v.string() },
  handler: async (ctx, { maintenanceRecordId }) =>
    await ctx.db
      .query("maintenanceRecordAssets")
      .withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", maintenanceRecordId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    maintenanceRecordId: v.string(),
    assetId: v.string(),
  },
  handler: async (ctx, args) => await ctx.db.insert("maintenanceRecordAssets", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      maintenanceRecordId: v.optional(v.string()),
      assetId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("maintenanceRecordAssets not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("maintenanceRecordAssets not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
