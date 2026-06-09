import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for SubTestRecord (Convex table "subTestRecords"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { testTagRecordId: v.string() },
  handler: async (ctx, { testTagRecordId }) =>
    await ctx.db
      .query("subTestRecords")
      .withIndex("by_testTagRecordId", (q) => q.eq("testTagRecordId", testTagRecordId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("subTestRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    testTagRecordId: v.string(),
    label: v.string(),
    sortOrder: v.optional(v.number()),
    result: v.optional(enums.TestResult),
    earthContinuityResult: v.optional(enums.TestResult),
    earthContinuityReading: v.optional(v.number()),
    insulationResult: v.optional(enums.TestResult),
    insulationReading: v.optional(v.number()),
    leakageCurrentResult: v.optional(enums.TestResult),
    leakageCurrentReading: v.optional(v.number()),
    polarityResult: v.optional(enums.TestResult),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("subTestRecords", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      testTagRecordId: v.optional(v.string()),
      label: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      result: v.optional(enums.TestResult),
      earthContinuityResult: v.optional(enums.TestResult),
      earthContinuityReading: v.optional(v.number()),
      insulationResult: v.optional(enums.TestResult),
      insulationReading: v.optional(v.number()),
      leakageCurrentResult: v.optional(enums.TestResult),
      leakageCurrentReading: v.optional(v.number()),
      polarityResult: v.optional(enums.TestResult),
      notes: v.optional(v.string()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("subTestRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("subTestRecords not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("subTestRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("subTestRecords not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
