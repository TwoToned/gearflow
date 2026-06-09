import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for DamageEvent (Convex table "damageEvents"). GENERATED — Phase 2.
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
      .query("damageEvents")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("damageEvents").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.optional(v.string()),
    lineItemId: v.optional(v.string()),
    lineItemUnitId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    severity: enums.DamageSeverity,
    status: v.optional(enums.DamageStatus),
    notes: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
    estimatedCost: v.optional(v.number()),
    actualCost: v.optional(v.number()),
    chargedBack: v.optional(v.boolean()),
    maintenanceRecordId: v.optional(v.string()),
    createdById: v.string(),
    reportedByCrewMemberId: v.optional(v.string()),
    discordIdempotencyKey: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("damageEvents", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      lineItemId: v.optional(v.string()),
      lineItemUnitId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      severity: v.optional(enums.DamageSeverity),
      status: v.optional(enums.DamageStatus),
      notes: v.optional(v.string()),
      photos: v.optional(v.array(v.string())),
      estimatedCost: v.optional(v.number()),
      actualCost: v.optional(v.number()),
      chargedBack: v.optional(v.boolean()),
      maintenanceRecordId: v.optional(v.string()),
      createdById: v.optional(v.string()),
      reportedByCrewMemberId: v.optional(v.string()),
      discordIdempotencyKey: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("damageEvents").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("damageEvents not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("damageEvents").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("damageEvents not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
