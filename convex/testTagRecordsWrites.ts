import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertRefInOrg } from "./lib/orgRef";
import * as enums from "./lib/validators";

/**
 * Native TEST-TAG-RECORD write state machine (Phase 3 browser-direct — replaces
 * `createTestTagRecord` in src/server/test-tag-records.ts). Folds what was a
 * multi-round-trip server action (write record → write sub-tests → patch asset →
 * failure actions → maintenance create+link+asset patch → recalculate status →
 * audit) into ONE atomic Convex mutation. Because ctx.db sees the mutation's own
 * writes, the final status recalculation reads the freshly-written record + patched
 * asset without any re-fetch round trip.
 *
 * Security bar (exact order): assertWritesEnabled → enforceBrowserWriteLimit →
 * requireOrgPermission(testTag,create) → resolveActor, then a per-row org re-check
 * on EVERY doc fetched by the global `by_cuid` index (testTagAsset + inventory asset).
 *
 * Prisma-seam replacements (the old action reached back into Postgres for these):
 *   • member validation (`prisma.member.findFirst`) → the `members` mirror (by_org_user).
 *   • tester/actor label (`user.name`) → resolveActor + the `users` mirror.
 *   • maintenance asset link (`createMaintenanceAssetLinks`) → inline
 *     `maintenanceRecordAssets` insert (the join is Convex-only since Phase B).
 *
 * Client-minted ids/now: the hook mints recordId, each subTest id, maintenanceId,
 * the maintenance-link id, and auditId, and passes `now` (a single stamp across the
 * whole write) + `testDate`/`nextDueDate` as epoch-ms numbers.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

const subTestArg = v.object({
  id: v.string(),
  label: v.string(),
  sortOrder: v.number(),
  result: v.optional(enums.TestResult),
  earthContinuityResult: v.optional(enums.TestResult),
  earthContinuityReading: v.optional(v.union(v.number(), v.null())),
  insulationResult: v.optional(enums.TestResult),
  insulationReading: v.optional(v.union(v.number(), v.null())),
  leakageCurrentResult: v.optional(enums.TestResult),
  leakageCurrentReading: v.optional(v.union(v.number(), v.null())),
  polarityResult: v.optional(enums.TestResult),
  notes: v.optional(v.string()),
});

/** dueSoon threshold (days) from the org's `orgSettings` blob; falls back to 14. */
async function orgDueSoonDays(ctx: MutationCtx, organizationId: string): Promise<number> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
    .unique();
  if (!row?.settings) return 14;
  try {
    const blob = JSON.parse(row.settings) as { testTag?: { dueSoonThresholdDays?: number } };
    return blob.testTag?.dueSoonThresholdDays || 14;
  } catch {
    return 14;
  }
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    orgId: v.string(),
    recordId: v.string(),
    testTagAssetId: v.string(),
    testProfileId: v.optional(v.string()),
    testDate: v.number(), // epoch ms
    nextDueDate: v.number(), // epoch ms
    testedById: v.optional(v.string()),
    testerName: v.string(),
    result: enums.TestResult,
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
    outletCount: v.optional(v.number()),
    subTests: v.optional(v.array(subTestArg)),
    maintenanceId: v.optional(v.string()),
    maintenanceLinkId: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testTag");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "create");
    const actor = await resolveActor(ctx, a.actor);

    // 2) Fetch the parent T&T asset + per-row org re-check (by_cuid is GLOBAL).
    const asset = await ctx.db
      .query("testTagAssets")
      .withIndex("by_cuid", (q) => q.eq("id", a.testTagAssetId))
      .unique();
    if (!asset || asset.organizationId !== a.orgId) throw new ConvexError("Test tag asset not found");

    // Org-validate the client-supplied testProfileId FK (by_cuid is GLOBAL — cross-org refs leak).
    if (a.testProfileId) await assertRefInOrg(ctx, "testProfiles", a.testProfileId, a.orgId);

    // 3) Tester defaults to the verified actor; a supplied non-self tester must be
    //    a member of the org (the members mirror replaces prisma.member.findFirst).
    const testedById = a.testedById || actor.userId;
    if (testedById !== actor.userId) {
      const member = await ctx.db
        .query("members")
        .withIndex("by_org_user", (q) => q.eq("organizationId", a.orgId).eq("userId", testedById))
        .first();
      if (!member) throw new ConvexError("Selected tester is not a member of this organisation");
    }

    // 4) Insert the test record at the client-minted id (hard-fail on replay,
    //    matching testTagAssetsWrites.createNative's dup-id convention).
    const dup = await ctx.db
      .query("testTagRecords")
      .withIndex("by_cuid", (q) => q.eq("id", a.recordId))
      .unique();
    if (dup) throw new ConvexError("Test tag record already exists");

    await ctx.db.insert("testTagRecords", {
      id: a.recordId,
      organizationId: a.orgId,
      testTagAssetId: a.testTagAssetId,
      ...(a.testProfileId && { testProfileId: a.testProfileId }),
      testDate: a.testDate,
      testedById,
      testerName: a.testerName,
      result: a.result,
      visualInspectionResult: a.visualInspectionResult || "PASS",
      ...(a.visualCordCondition !== undefined && { visualCordCondition: a.visualCordCondition }),
      ...(a.visualPlugCondition !== undefined && { visualPlugCondition: a.visualPlugCondition }),
      ...(a.visualHousingCondition !== undefined && { visualHousingCondition: a.visualHousingCondition }),
      ...(a.visualSwitchCondition !== undefined && { visualSwitchCondition: a.visualSwitchCondition }),
      ...(a.visualVentsUnobstructed !== undefined && { visualVentsUnobstructed: a.visualVentsUnobstructed }),
      ...(a.visualCordGrip !== undefined && { visualCordGrip: a.visualCordGrip }),
      ...(a.visualEarthPin !== undefined && { visualEarthPin: a.visualEarthPin }),
      ...(a.visualMarkingsLegible !== undefined && { visualMarkingsLegible: a.visualMarkingsLegible }),
      ...(a.visualNoModifications !== undefined && { visualNoModifications: a.visualNoModifications }),
      ...(a.visualNotes && { visualNotes: a.visualNotes }),
      equipmentClassTested: a.equipmentClassTested || "CLASS_I",
      testMethod: a.testMethod || "INSULATION_RESISTANCE",
      earthContinuityResult: a.earthContinuityResult || "NOT_APPLICABLE",
      ...(a.earthContinuityReading !== undefined && { earthContinuityReading: a.earthContinuityReading }),
      insulationResult: a.insulationResult || "NOT_APPLICABLE",
      ...(a.insulationReading !== undefined && { insulationReading: a.insulationReading }),
      ...(a.insulationTestVoltage !== undefined && { insulationTestVoltage: a.insulationTestVoltage }),
      leakageCurrentResult: a.leakageCurrentResult || "NOT_APPLICABLE",
      ...(a.leakageCurrentReading !== undefined && { leakageCurrentReading: a.leakageCurrentReading }),
      polarityResult: a.polarityResult || "NOT_APPLICABLE",
      rcdTripTimeResult: a.rcdTripTimeResult || "NOT_APPLICABLE",
      ...(a.rcdTripTimeReading !== undefined && { rcdTripTimeReading: a.rcdTripTimeReading }),
      functionalTestResult: a.functionalTestResult || "NOT_APPLICABLE",
      ...(a.functionalTestNotes && { functionalTestNotes: a.functionalTestNotes }),
      failureAction: a.failureAction || "NONE",
      ...(a.failureNotes && { failureNotes: a.failureNotes }),
      nextDueDate: a.nextDueDate,
      createdAt: a.now,
      updatedAt: a.now,
    });

    // 5) Insert sub-tests (each at its client-minted id, idempotent per id).
    if (a.subTests && a.subTests.length > 0) {
      for (const st of a.subTests) {
        const stDup = await ctx.db
          .query("subTestRecords")
          .withIndex("by_cuid", (q) => q.eq("id", st.id))
          .unique();
        if (stDup) {
          // Same-record retry → idempotent skip. A collision with a DIFFERENT record's
          // sub-test (subTestRecords has no org column; ownership is via the parent) is a
          // deliberate foreign id — reject rather than silently drop the caller's sub-test.
          if (stDup.testTagRecordId !== a.recordId) {
            throw new ConvexError("Sub-test id collision");
          }
          continue;
        }
        await ctx.db.insert("subTestRecords", {
          id: st.id,
          testTagRecordId: a.recordId,
          label: st.label,
          sortOrder: st.sortOrder,
          result: st.result || "PASS",
          earthContinuityResult: st.earthContinuityResult || "NOT_APPLICABLE",
          ...(st.earthContinuityReading != null && { earthContinuityReading: st.earthContinuityReading }),
          insulationResult: st.insulationResult || "NOT_APPLICABLE",
          ...(st.insulationReading != null && { insulationReading: st.insulationReading }),
          leakageCurrentResult: st.leakageCurrentResult || "NOT_APPLICABLE",
          ...(st.leakageCurrentReading != null && { leakageCurrentReading: st.leakageCurrentReading }),
          polarityResult: st.polarityResult || "NOT_APPLICABLE",
          ...(st.notes && { notes: st.notes }),
          createdAt: a.now,
        });
      }
    }

    // 6) Patch the parent asset scalars.
    const assetPatch: Record<string, unknown> = {
      lastTestDate: a.testDate,
      nextDueDate: a.nextDueDate,
      updatedAt: a.now,
    };
    if (a.outletCount) assetPatch.outletCount = a.outletCount;
    if (!asset.testProfileId && a.testProfileId) assetPatch.testProfileId = a.testProfileId;
    await ctx.db.patch(asset._id, assetPatch);

    // 7) Failure actions (only on a FAIL result).
    if (a.result === "FAIL") {
      if (a.failureAction === "REMOVED_FROM_SERVICE") {
        await ctx.db.patch(asset._id, { status: "FAILED" });
      } else if (a.failureAction === "DISPOSED") {
        await ctx.db.patch(asset._id, { status: "RETIRED", isActive: false });
      } else if (a.failureAction === "REFERRED_TO_ELECTRICIAN" && asset.assetId) {
        const maintenanceId = a.maintenanceId || createId();
        const description = a.failureNotes
          ? `Failed test & tag inspection. Notes: ${a.failureNotes}`
          : `Failed test & tag inspection on ${new Date(a.testDate).toLocaleDateString()}. Referred to electrician for repair.`;
        const mDup = await ctx.db
          .query("maintenanceRecords")
          .withIndex("by_cuid", (q) => q.eq("id", maintenanceId))
          .unique();
        // by_cuid is GLOBAL: a replayed maintenanceId that belongs to ANOTHER org must
        // NOT be reused — otherwise the link below would point a foreign maintenance
        // record at this caller's asset (cross-tenant injection). Reject the collision.
        if (mDup && mDup.organizationId !== a.orgId) {
          throw new ConvexError("Maintenance record id already exists");
        }
        if (!mDup) {
          await ctx.db.insert("maintenanceRecords", {
            id: maintenanceId,
            organizationId: a.orgId,
            type: "REPAIR",
            status: "SCHEDULED",
            title: `Electrician referral — ${asset.testTagId}`,
            description,
            reportedById: actor.userId,
            createdAt: a.now,
            updatedAt: a.now,
          });
        }
        // Maintenance→asset link (Convex-only join; parent-scoped, no org column).
        // Idempotent on (maintenanceRecordId, assetId) — mirrors createMaintenanceAssetLinks.
        const existingLinks = await ctx.db
          .query("maintenanceRecordAssets")
          .withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", maintenanceId))
          .collect();
        if (!existingLinks.some((l) => l.assetId === asset.assetId)) {
          await ctx.db.insert("maintenanceRecordAssets", {
            id: a.maintenanceLinkId || createId(),
            maintenanceRecordId: maintenanceId,
            assetId: asset.assetId,
          });
        }
        // Mark the linked INVENTORY asset in-maintenance (per-row org re-check).
        const invAsset = await ctx.db
          .query("assets")
          .withIndex("by_cuid", (q) => q.eq("id", asset.assetId!))
          .unique();
        if (!invAsset || invAsset.organizationId !== a.orgId) throw new ConvexError("Linked asset not found");
        await ctx.db.patch(invAsset._id, { status: "IN_MAINTENANCE", updatedAt: a.now });
      }
    }

    // 8) Recompute the asset status from the FRESH state (ctx.db sees our writes).
    //    Runs AFTER the failure-action patches so a DISPOSED (RETIRED) asset is
    //    preserved by the early return.
    await recalculateStatus(ctx, a.testTagAssetId, a.orgId, a.now);

    // 9) Audit (folded into the same transaction).
    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "CREATE",
      entityType: "testTagRecord",
      entityId: a.recordId,
      entityName: asset.testTagId ?? "",
      userId: actor.userId,
      userName: actor.userName,
      summary: `Recorded ${a.result} test for ${asset.testTagId}`,
      details: { result: a.result, testerName: a.testerName, profileId: a.testProfileId },
      createdAt: a.now,
    });

    return { id: a.recordId };
  },
});

/**
 * Recompute + patch a T&T asset's status from its latest record + due dates. Port
 * of `recalculateStatus` (src/server/test-tag-records.ts) reading Convex directly.
 * Re-reads the asset so it observes the failure-action patches from step 7.
 */
async function recalculateStatus(
  ctx: MutationCtx,
  testTagAssetId: string,
  orgId: string,
  now: number,
): Promise<void> {
  const asset = await ctx.db
    .query("testTagAssets")
    .withIndex("by_cuid", (q) => q.eq("id", testTagAssetId))
    .unique();
  if (!asset || asset.organizationId !== orgId) return;
  if (asset.status === "RETIRED") return; // preserve DISPOSED

  const records = await ctx.db
    .query("testTagRecords")
    .withIndex("by_organizationId_testTagAssetId", (q) =>
      q.eq("organizationId", orgId).eq("testTagAssetId", testTagAssetId),
    )
    .collect();
  const latest = [...records].sort((x, y) => (y.testDate ?? 0) - (x.testDate ?? 0))[0];

  if (!latest) {
    await ctx.db.patch(asset._id, { status: "NOT_YET_TESTED" });
    return;
  }
  if (latest.result === "FAIL") {
    await ctx.db.patch(asset._id, { status: "FAILED" });
    return;
  }

  const nextDue = asset.nextDueDate ?? null;
  if (!nextDue || nextDue < now) {
    await ctx.db.patch(asset._id, { status: "OVERDUE" });
    return;
  }
  const dueSoonMs = (await orgDueSoonDays(ctx, orgId)) * 24 * 60 * 60 * 1000;
  await ctx.db.patch(asset._id, { status: nextDue <= now + dueSoonMs ? "DUE_SOON" : "CURRENT" });
}
