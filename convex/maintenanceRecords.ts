import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for MaintenanceRecord (Convex table "maintenanceRecords"). GENERATED — Phase 2.
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
      .query("maintenanceRecords")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    kitId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    type: enums.MaintenanceType,
    status: v.optional(enums.MaintenanceStatus),
    title: v.string(),
    description: v.optional(v.string()),
    reportedById: v.optional(v.string()),
    assignedToId: v.optional(v.string()),
    scheduledDate: v.optional(v.number()),
    completedDate: v.optional(v.number()),
    cost: v.optional(v.number()),
    partsUsed: v.optional(v.string()),
    attachments: v.optional(v.array(v.string())),
    photos: v.optional(v.array(v.string())),
    result: v.optional(enums.MaintenanceResult),
    nextDueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("maintenanceRecords", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      kitId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      type: v.optional(enums.MaintenanceType),
      status: v.optional(enums.MaintenanceStatus),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      reportedById: v.optional(v.string()),
      assignedToId: v.optional(v.string()),
      scheduledDate: v.optional(v.number()),
      completedDate: v.optional(v.number()),
      cost: v.optional(v.number()),
      partsUsed: v.optional(v.string()),
      attachments: v.optional(v.array(v.string())),
      photos: v.optional(v.array(v.string())),
      result: v.optional(enums.MaintenanceResult),
      nextDueDate: v.optional(v.number()),
      tags: v.optional(v.array(v.string())),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("maintenanceRecords not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("maintenanceRecords not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
