import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for TestTagRecord (Convex table "testTagRecords"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("testTagRecords")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
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
    if (!doc) throw new Error("testTagRecords not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("testTagRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("testTagRecords not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
