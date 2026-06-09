import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewTimeEntry (Convex table "crewTimeEntries"). GENERATED — Phase 2.
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
      .query("crewTimeEntries")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assignmentId: v.optional(v.string()),
    crewMemberId: v.string(),
    description: v.optional(v.string()),
    date: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    breakMinutes: v.optional(v.number()),
    totalHours: v.optional(v.number()),
    status: v.optional(enums.TimeEntryStatus),
    approvedById: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("crewTimeEntries", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      assignmentId: v.optional(v.string()),
      crewMemberId: v.optional(v.string()),
      description: v.optional(v.string()),
      date: v.optional(v.number()),
      startTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      breakMinutes: v.optional(v.number()),
      totalHours: v.optional(v.number()),
      status: v.optional(enums.TimeEntryStatus),
      approvedById: v.optional(v.string()),
      approvedAt: v.optional(v.number()),
      notes: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewTimeEntries not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewTimeEntries not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
