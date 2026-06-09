import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for SavedReport (Convex table "savedReports"). GENERATED — Phase 2/5.
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
      .query("savedReports")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("savedReports").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    dataSource: v.string(),
    config: v.any(),
    createdById: v.optional(v.string()),
    isShared: v.optional(v.boolean()),
    isPinned: v.optional(v.boolean()),
    scheduleFrequency: v.optional(enums.ScheduleFrequency),
    scheduleHour: v.optional(v.number()),
    scheduleDayOfWeek: v.optional(v.number()),
    scheduleDayOfMonth: v.optional(v.number()),
    scheduleRecipients: v.optional(v.array(v.string())),
    scheduleLastRunAt: v.optional(v.number()),
    lastRunAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("savedReports", args);
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      dataSource: v.optional(v.string()),
      config: v.optional(v.any()),
      createdById: v.optional(v.string()),
      isShared: v.optional(v.boolean()),
      isPinned: v.optional(v.boolean()),
      scheduleFrequency: v.optional(enums.ScheduleFrequency),
      scheduleHour: v.optional(v.number()),
      scheduleDayOfWeek: v.optional(v.number()),
      scheduleDayOfMonth: v.optional(v.number()),
      scheduleRecipients: v.optional(v.array(v.string())),
      scheduleLastRunAt: v.optional(v.number()),
      lastRunAt: v.optional(v.number()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("savedReports").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("savedReports not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("savedReports").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("savedReports not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
