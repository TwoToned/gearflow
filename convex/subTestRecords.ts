import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for SubTestRecord (Convex table "subTestRecords"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { testTagRecordId: v.string() },
  handler: async (ctx, { testTagRecordId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("subTestRecords")
      .withIndex("by_testTagRecordId", (q) => q.eq("testTagRecordId", testTagRecordId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("subTestRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * Sub-test records across many parent test records in one round trip. Used by the
 * T&T reports (session / failed-items / item-history) which need sub-tests for a
 * whole result set — fetching per-record would be N round trips. HAND-ADDED for
 * the Phase A read-rewiring (subTestRecord has no org column; it is parent-scoped).
 */
export const listByRecordIds = query({
  args: { recordIds: v.array(v.string()) },
  handler: async (ctx, { recordIds }) => {
    await requireService(ctx);
    const out = [];
    for (const recordId of recordIds) {
      const rows = await ctx.db
        .query("subTestRecords")
        .withIndex("by_testTagRecordId", (q) => q.eq("testTagRecordId", recordId))
        .collect();
      out.push(...rows);
    }
    return out;
  },
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("subTestRecords", args);
  },
});

export const createIfMissing = mutation({
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("subTestRecords").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("subTestRecords", args);
    return { _id, created: true };
  },
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
    await requireService(ctx);
    const doc = await ctx.db.query("subTestRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("subTestRecords not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("subTestRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("subTestRecords not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
