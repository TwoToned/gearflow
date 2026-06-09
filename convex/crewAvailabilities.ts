import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewAvailability (Convex table "crewAvailabilities"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { crewMemberId: v.string() },
  handler: async (ctx, { crewMemberId }) =>
    await ctx.db
      .query("crewAvailabilities")
      .withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", crewMemberId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    crewMemberId: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    type: v.optional(enums.AvailabilityType),
    reason: v.optional(v.string()),
    isAllDay: v.optional(v.boolean()),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("crewAvailabilities", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      crewMemberId: v.optional(v.string()),
      startDate: v.optional(v.number()),
      endDate: v.optional(v.number()),
      type: v.optional(enums.AvailabilityType),
      reason: v.optional(v.string()),
      isAllDay: v.optional(v.boolean()),
      startTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewAvailabilities not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewAvailabilities not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
