import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgReadDocFor } from "./lib/auth";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

// subTestRecords is a parent-scoped table (no `organizationId` column of its
// own). `list`/`getById` are single-parent lookups, so they widen by fetching
// the parent `testTagRecords` doc and org-checking THAT via
// requireOrgReadDocFor (R-8.4.3 pattern for a non-org foreign key).
// `listByRecordIds` fans out across MANY caller-supplied parent ids with no
// per-id org filter — widening that needs a verify-and-filter redesign, out of
// scope for this pass, so it stays denied.
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List the sub-test rows for one test & tag record.", danger: "low", mcpTier: 3 },
  getById: { summary: "Get a single sub-test record by id.", danger: "low", mcpTier: 3 },
  listByRecordIds: { agentAccess: "denied", reason: "Batch join across caller-supplied recordIds with no per-id org check — would need a verify-and-filter redesign to scope safely." },
};

/**
 * Thin CRUD for SubTestRecord (Convex table "subTestRecords"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { testTagRecordId: v.string() },
  handler: async (ctx, { testTagRecordId }) => {
    const parent = await ctx.db.query("testTagRecords").withIndex("by_cuid", (q) => q.eq("id", testTagRecordId)).unique();
    await requireOrgReadDocFor(ctx, parent, "testTag");
    if (!parent) return [];
    return await ctx.db
      .query("subTestRecords")
      .withIndex("by_testTagRecordId", (q) => q.eq("testTagRecordId", testTagRecordId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("subTestRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    const parent = doc
      ? await ctx.db.query("testTagRecords").withIndex("by_cuid", (q) => q.eq("id", doc.testTagRecordId)).unique()
      : null;
    await requireOrgReadDocFor(ctx, parent, "testTag");
    // Orphaned row (parent missing) falls through requireOrgReadDocFor's
    // "nothing to leak" null-doc branch regardless of the caller's org — guard
    // it explicitly so an orphan is never handed back unscoped.
    if (doc && !parent) return null;
    return doc;
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

export const subTestFields = {
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
};

export const create = mutation({
  args: subTestFields,
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("subTestRecords", args);
  },
});

/**
 * Insert many sub-test records in ONE round trip (bulk single-call invariant —
 * a T&T record's sub-tests are all created from one form submit; the server was
 * looping `createIfMissing` per sub-test). Idempotent per `id` (safe on retry).
 *
 * subTestRecords have no org column — they are parent-scoped — so defense-in-depth:
 * every distinct `testTagRecordId` is verified to belong to `organizationId` before
 * ANY insert (one parent lookup per distinct record, cached). A record that doesn't
 * match the caller's org aborts the whole batch (transactional: one record's
 * sub-tests are a single logical set).
 */
export const createManyIfMissing = mutation({
  args: {
    organizationId: v.string(),
    records: v.array(v.object(subTestFields)),
  },
  handler: async (ctx, { organizationId, records }) => {
    await requireService(ctx);

    // Per-parent org re-check (by_cuid is a GLOBAL index) — cache by parent id.
    const verifiedParents = new Map<string, boolean>();
    for (const rec of records) {
      if (!verifiedParents.has(rec.testTagRecordId)) {
        const parent = await ctx.db
          .query("testTagRecords")
          .withIndex("by_cuid", (q) => q.eq("id", rec.testTagRecordId))
          .unique(); // fail-closed on the (impossible) duplicate-cuid case, matching getById/createIfMissing
        const ok = !!parent && parent.organizationId === organizationId;
        verifiedParents.set(rec.testTagRecordId, ok);
        if (!ok) {
          throw new ConvexError(
            "Forbidden: test record not found in organization: " + rec.testTagRecordId,
          );
        }
      }
    }

    let created = 0;
    for (const args of records) {
      const existing = await ctx.db
        .query("subTestRecords")
        .withIndex("by_cuid", (q) => q.eq("id", args.id))
        .unique();
      if (existing) continue;
      await ctx.db.insert("subTestRecords", args);
      created += 1;
    }
    return { created };
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
