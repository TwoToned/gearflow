import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireService, requireOrgRead } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for TestTagRecord (Convex table "testTagRecords"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("testTagRecords")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("testTagRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * All test records for a single test tag asset, via the `by_testTagAssetId`
 * index. Used by the asset-detail / scan reads to attach the recent test
 * history. Service-only (not on the browser-readable allowlist).
 */
/** All test records created by a given user (for user-delete cascade). */
export const listByTestedById = query({
  args: { testedById: v.string() },
  handler: async (ctx, { testedById }) => {
    await requireService(ctx);
    return await ctx.db
      .query("testTagRecords")
      .withIndex("by_testedById", (q) => q.eq("testedById", testedById))
      .collect();
  },
});

export const listByAssetId = query({
  args: { testTagAssetId: v.string() },
  handler: async (ctx, { testTagAssetId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("testTagRecords")
      .withIndex("by_testTagAssetId", (q) => q.eq("testTagAssetId", testTagAssetId))
      .collect();
  },
});

/**
 * Records for one asset within an org, in one round trip. Used by the
 * per-asset test history (`getTestTagRecords`) and the Quick Pass pre-fill
 * (`getLatestTestRecord`) reads. Org-scoped via the composite index so a stray
 * cross-org id can't leak. Caller sorts by `testDate` desc + paginates.
 * HAND-ADDED for the Phase A read-rewiring of the test-tag records surface.
 */
export const listByOrgAndAsset = query({
  args: { orgId: v.string(), testTagAssetId: v.string() },
  handler: async (ctx, { orgId, testTagAssetId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("testTagRecords")
      .withIndex("by_organizationId_testTagAssetId", (q) =>
        q.eq("organizationId", orgId).eq("testTagAssetId", testTagAssetId),
      )
      .collect();
  },
});
/**
 * Attach the record-history relations the Prisma `include` used to resolve — the
 * record's OWN test profile ({id,name}, org-scoped), the tester name (from the
 * `users` mirror: name → email → id, NOT Prisma), and its sub-tests (sorted by
 * sortOrder asc). Browser-direct re-home of `attachRecordRelations`
 * (src/server/test-tag-records.ts) + `getUserNameMap` (Prisma) into Convex.
 */
async function attachRelations(
  ctx: QueryCtx,
  orgId: string,
  rec: Record<string, unknown>,
): Promise<
  Record<string, unknown> & {
    testedBy: { id: string; name: string | null };
    testProfile: { id: string; name: string } | null;
    subTestRecords: Record<string, unknown>[];
  }
> {
  const testedById = rec.testedById as string;
  const testProfileId = rec.testProfileId as string | undefined;
  const recordId = rec.id as string;

  let testProfile: { id: string; name: string } | null = null;
  if (testProfileId) {
    const p = await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", testProfileId)).first();
    if (p && p.organizationId === orgId) testProfile = { id: p.id, name: p.name };
  }

  // Parity with the deleted attachRecordRelations: the name is the mirrored user's
  // name or null (never the raw id/email) — consumers rendered null when unresolved.
  const user = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", testedById)).first();
  const testerName: string | null = user?.name || null;

  const subTestRecords = (
    await ctx.db.query("subTestRecords").withIndex("by_testTagRecordId", (q) => q.eq("testTagRecordId", recordId)).collect()
  ).sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0));

  return { ...rec, testedBy: { id: testedById, name: testerName }, testProfile, subTestRecords };
}

/**
 * Paginated test history for one asset (browser-direct re-home of the server
 * `getTestTagRecords`). Org-scoped read + per-row org re-check; sort testDate desc,
 * slice the page, attach relations. Returns `{ records, total, page, pageSize,
 * totalPages }` — the same shape the record-history consumer expects.
 */
export const recordsPage = query({
  args: {
    orgId: v.string(),
    testTagAssetId: v.string(),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, testTagAssetId, page, pageSize }) => {
    await requireOrgRead(ctx, orgId);
    const p = page ?? 1;
    const ps = pageSize ?? 20;
    const all = (
      await ctx.db
        .query("testTagRecords")
        .withIndex("by_organizationId_testTagAssetId", (q) =>
          q.eq("organizationId", orgId).eq("testTagAssetId", testTagAssetId),
        )
        .collect()
    ).sort((a, b) => (b.testDate ?? 0) - (a.testDate ?? 0));
    const total = all.length;
    const slice = all.slice((p - 1) * ps, (p - 1) * ps + ps);
    const records = [];
    for (const r of slice) records.push(await attachRelations(ctx, orgId, r));
    return { records, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  },
});

/**
 * Latest test record for one asset (browser-direct re-home of the server
 * `getLatestTestRecord`; backs the Quick Pass pre-fill). Null if none. Org-scoped.
 */
export const latestForAsset = query({
  args: { orgId: v.string(), testTagAssetId: v.string() },
  handler: async (ctx, { orgId, testTagAssetId }) => {
    await requireOrgRead(ctx, orgId);
    const all = (
      await ctx.db
        .query("testTagRecords")
        .withIndex("by_organizationId_testTagAssetId", (q) =>
          q.eq("organizationId", orgId).eq("testTagAssetId", testTagAssetId),
        )
        .collect()
    ).sort((a, b) => (b.testDate ?? 0) - (a.testDate ?? 0));
    const latest = all[0];
    if (!latest) return null;
    return await attachRelations(ctx, orgId, latest);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    testTagAssetId: v.string(),
    testProfileId: v.optional(v.string()),
    testDate: v.number(),
    testedById: v.string(),
    testerName: v.string(),
    result: v.optional(enums.TestResult),
    visualInspectionResult: v.optional(enums.TestResult),
    visualCordCondition: v.optional(v.boolean()),
    visualPlugCondition: v.optional(v.boolean()),
    visualHousingCondition: v.optional(v.boolean()),
    visualSwitchCondition: v.optional(v.boolean()),
    visualVentsUnobstructed: v.optional(v.boolean()),
    visualCordGrip: v.optional(v.boolean()),
    visualEarthPin: v.optional(v.boolean()),
    visualMarkingsLegible: v.optional(v.boolean()),
    visualNoModifications: v.optional(v.boolean()),
    visualNotes: v.optional(v.string()),
    equipmentClassTested: v.optional(enums.EquipmentClass),
    testMethod: v.optional(enums.TestMethod),
    earthContinuityResult: v.optional(enums.TestResult),
    earthContinuityReading: v.optional(v.number()),
    insulationResult: v.optional(enums.TestResult),
    insulationReading: v.optional(v.number()),
    insulationTestVoltage: v.optional(v.number()),
    leakageCurrentResult: v.optional(enums.TestResult),
    leakageCurrentReading: v.optional(v.number()),
    polarityResult: v.optional(enums.TestResult),
    rcdTripTimeResult: v.optional(enums.TestResult),
    rcdTripTimeReading: v.optional(v.number()),
    functionalTestResult: v.optional(enums.TestResult),
    functionalTestNotes: v.optional(v.string()),
    failureAction: v.optional(enums.FailureAction),
    failureNotes: v.optional(v.string()),
    nextDueDate: v.number(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("testTagRecords", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    testTagAssetId: v.string(),
    testProfileId: v.optional(v.string()),
    testDate: v.number(),
    testedById: v.string(),
    testerName: v.string(),
    result: v.optional(enums.TestResult),
    visualInspectionResult: v.optional(enums.TestResult),
    visualCordCondition: v.optional(v.boolean()),
    visualPlugCondition: v.optional(v.boolean()),
    visualHousingCondition: v.optional(v.boolean()),
    visualSwitchCondition: v.optional(v.boolean()),
    visualVentsUnobstructed: v.optional(v.boolean()),
    visualCordGrip: v.optional(v.boolean()),
    visualEarthPin: v.optional(v.boolean()),
    visualMarkingsLegible: v.optional(v.boolean()),
    visualNoModifications: v.optional(v.boolean()),
    visualNotes: v.optional(v.string()),
    equipmentClassTested: v.optional(enums.EquipmentClass),
    testMethod: v.optional(enums.TestMethod),
    earthContinuityResult: v.optional(enums.TestResult),
    earthContinuityReading: v.optional(v.number()),
    insulationResult: v.optional(enums.TestResult),
    insulationReading: v.optional(v.number()),
    insulationTestVoltage: v.optional(v.number()),
    leakageCurrentResult: v.optional(enums.TestResult),
    leakageCurrentReading: v.optional(v.number()),
    polarityResult: v.optional(enums.TestResult),
    rcdTripTimeResult: v.optional(enums.TestResult),
    rcdTripTimeReading: v.optional(v.number()),
    functionalTestResult: v.optional(enums.TestResult),
    functionalTestNotes: v.optional(v.string()),
    failureAction: v.optional(enums.FailureAction),
    failureNotes: v.optional(v.string()),
    nextDueDate: v.number(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("testTagRecords").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("testTagRecords", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      testTagAssetId: v.optional(v.string()),
      testProfileId: v.optional(v.string()),
      testDate: v.optional(v.number()),
      testedById: v.optional(v.string()),
      testerName: v.optional(v.string()),
      result: v.optional(enums.TestResult),
      visualInspectionResult: v.optional(enums.TestResult),
      visualCordCondition: v.optional(v.boolean()),
      visualPlugCondition: v.optional(v.boolean()),
      visualHousingCondition: v.optional(v.boolean()),
      visualSwitchCondition: v.optional(v.boolean()),
      visualVentsUnobstructed: v.optional(v.boolean()),
      visualCordGrip: v.optional(v.boolean()),
      visualEarthPin: v.optional(v.boolean()),
      visualMarkingsLegible: v.optional(v.boolean()),
      visualNoModifications: v.optional(v.boolean()),
      visualNotes: v.optional(v.string()),
      equipmentClassTested: v.optional(enums.EquipmentClass),
      testMethod: v.optional(enums.TestMethod),
      earthContinuityResult: v.optional(enums.TestResult),
      earthContinuityReading: v.optional(v.number()),
      insulationResult: v.optional(enums.TestResult),
      insulationReading: v.optional(v.number()),
      insulationTestVoltage: v.optional(v.number()),
      leakageCurrentResult: v.optional(enums.TestResult),
      leakageCurrentReading: v.optional(v.number()),
      polarityResult: v.optional(enums.TestResult),
      rcdTripTimeResult: v.optional(enums.TestResult),
      rcdTripTimeReading: v.optional(v.number()),
      functionalTestResult: v.optional(enums.TestResult),
      functionalTestNotes: v.optional(v.string()),
      failureAction: v.optional(enums.FailureAction),
      failureNotes: v.optional(v.string()),
      nextDueDate: v.optional(v.number()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("testTagRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("testTagRecords not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("testTagRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("testTagRecords not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
