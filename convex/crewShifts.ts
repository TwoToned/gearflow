import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewShift (Convex table "crewShifts"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { assignmentId: v.string() },
  handler: async (ctx, { assignmentId }) =>
    await ctx.db
      .query("crewShifts")
      .withIndex("by_assignmentId", (q) => q.eq("assignmentId", assignmentId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("crewShifts").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    assignmentId: v.string(),
    date: v.number(),
    callTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    breakMinutes: v.optional(v.number()),
    location: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(enums.ShiftStatus),
  },
  handler: async (ctx, args) => await ctx.db.insert("crewShifts", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      assignmentId: v.optional(v.string()),
      date: v.optional(v.number()),
      callTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      breakMinutes: v.optional(v.number()),
      location: v.optional(v.string()),
      notes: v.optional(v.string()),
      status: v.optional(enums.ShiftStatus),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("crewShifts").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewShifts not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewShifts").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewShifts not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
