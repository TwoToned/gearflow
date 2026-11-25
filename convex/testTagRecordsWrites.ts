import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen } from "./lib/fieldGuards";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { deriveNextDueDate } from "./lib/testTagNextDue";
import { orgTestProfile, resolveTestProfileForAsset } from "./lib/testProfileResolve";
import {
  assertTopLevelReadings,
  checkSubTest,
  deriveOverallResult,
  deriveVisualResult,
  parseProfileTests,
} from "./lib/testTagReadings";
import {
  invAssetSnapshot,
  loadUndoableTestSave,
  requireNewestRecord,
  requireUntouchedInventory,
  sameSnapshot,
  ttAssetRestorePatch,
  ttAssetSnapshot,
  type TestTagSaveDetails,
} from "./lib/testTagUndo";
import { deleteMaintenanceWithLinks, requireUntouchedMaintenance } from "./lib/undoMaintenance";
import { nextStatusUnlessRetired } from "./lib/assetRetire";

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
 * Phase 16 — the server is the authority on what a test means:
 *   • D52: `nextDueDate` is DERIVED (`deriveNextDueDate(testDate, interval)`), never an
 *     argument; a FAILED test stores the same date ("Next due after repair").
 *   • D51 / Q11: every reading carries its own verdict, every test the resolved profile
 *     enables must be answered (a blank is rejected, an explicit N/A is not), and a
 *     stated threshold decides the verdict (`convex/lib/testTagReadings.ts`).
 *   • The overall `result` (and each sub-test's) is DERIVED from those verdicts — it is
 *     no longer an argument (the live bug was storing whatever the client sent).
 *   • Its audit row carries the before/after snapshot `undoCreateNative` reads (Q2).
 *
 * Client-minted ids/now: the hook mints recordId, each subTest id, maintenanceId,
 * the maintenance-link id, and auditId, and passes `now` (a single stamp across the
 * whole write) + `testDate` as epoch-ms numbers.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** The outlet stepper's cap (sub-test profiles) — mirrored here so the write is bounded. */
const MAX_SUB_TESTS = 50;

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

const createArgs = {
  orgId: v.string(),
  recordId: v.string(),
  testTagAssetId: v.string(),
  testProfileId: v.optional(v.string()),
  testDate: v.number(), // epoch ms
  testedById: v.optional(v.string()),
  testerName: v.string(),
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
  rcdTripCurrentResult: v.optional(enums.TestResult),
  rcdTripCurrentReading: v.optional(v.number()),
  rcdPushButtonResult: v.optional(enums.TestResult),
  microwaveLeakageResult: v.optional(enums.TestResult),
  microwaveLeakageReading: v.optional(v.number()),
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
};

type SubTestInput = {
  id: string; label: string; sortOrder: number;
  result?: "PASS" | "FAIL" | "NOT_APPLICABLE";
  earthContinuityResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; earthContinuityReading?: number | null;
  insulationResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; insulationReading?: number | null;
  leakageCurrentResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; leakageCurrentReading?: number | null;
  polarityResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; notes?: string;
};

/** R-8.6.2: mirror testTagRecordSchema/subTestRecordSchema's bounds (client Zod
 *  validation is bypassable by any caller hitting this Native mutation directly). */
function assertCreateFields(a: { testerName: string; visualNotes?: string; functionalTestNotes?: string; failureNotes?: string; subTests?: SubTestInput[] }): void {
  assertStrLen(a.testerName, "Tester name", { max: 200 });
  assertStrLen(a.visualNotes, "Visual notes", { max: 2000 });
  assertStrLen(a.functionalTestNotes, "Functional test notes", { max: 2000 });
  assertStrLen(a.failureNotes, "Failure notes", { max: 2000 });
  if ((a.subTests?.length ?? 0) > MAX_SUB_TESTS) throw new ConvexError(`At most ${MAX_SUB_TESTS} sub-tests`);
  for (const st of a.subTests ?? []) {
    assertStrLen(st.label, "Sub-test label", { max: 100 });
    assertStrLen(st.notes, "Sub-test notes", { max: 2000 });
  }
}

/**
 * The profile the test is held to is ALWAYS the asset's resolved cascade — the one the
 * tester saw (`testCard` / `resolveForAsset`). A caller may name it (`testProfileId`),
 * but only to confirm it: naming another profile (a laxer one would switch D51 off, and
 * would then be pinned onto the asset), a foreign one or an inactive one is rejected.
 */
async function profileForTest(ctx: MutationCtx, orgId: string, asset: Doc<"testTagAssets">, testProfileId: string | undefined) {
  const resolved = await resolveTestProfileForAsset(ctx, orgId, asset);
  if (!testProfileId) return resolved;
  const named = await orgTestProfile(ctx, orgId, testProfileId);
  if (!named) throw new ConvexError("Test profile not found");
  if (named.isActive === false) throw new ConvexError("That test profile is inactive");
  if (named.id !== resolved?.id) {
    throw new ConvexError(resolved ? `This item is tested against "${resolved.name}", not the profile sent` : "No test profile applies to this item");
  }
  return resolved;
}

/** D51 + Q11: validate every reading and derive the verdicts the record stores. */
function deriveVerdicts(a: Record<string, unknown> & { subTests?: SubTestInput[] }, profile: Doc<"testProfiles"> | null) {
  const tests = parseProfileTests(profile?.electricalTests);
  assertTopLevelReadings(a, tests);
  const subKeys = new Set(profile?.requiresSubTests ? tests.filter((t) => t.enabled).map((t) => t.key) : []);
  const thresholds = (profile?.thresholds && typeof profile.thresholds === "object" ? profile.thresholds : {}) as Record<string, unknown>;
  const subResults = (a.subTests ?? []).map((st) => checkSubTest(st, subKeys, thresholds));
  const visual = deriveVisualResult(a);
  return { visual, subResults, result: deriveOverallResult(a, visual, subResults) };
}

/** Only the defined keys of `fields` (the record stores absent, never `undefined`). */
function definedOnly(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, val]) => val !== undefined && val !== null && val !== ""));
}

export const createNative = mutation({
  returns: v.object({ id: v.string(), nextDueDate: v.number(), result: v.union(v.literal("PASS"), v.literal("FAIL")) }),
  args: createArgs,
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testTag");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "create");
    const actor = await resolveActor(ctx, a.actor);
    assertCreateFields(a);
    if (a.testDate > Date.now() + TEST_DATE_SKEW_MS) throw new ConvexError("The test date can't be in the future");

    // The parent T&T asset, org re-checked (by_cuid is GLOBAL).
    const asset = await requireTtAssetInOrg(ctx, a.orgId, a.testTagAssetId);
    const profile = await profileForTest(ctx, a.orgId, asset, a.testProfileId);
    assertOutlets(a, profile);
    const verdicts = deriveVerdicts(a, profile);
    const testedById = await resolveTester(ctx, a.orgId, a.testedById, actor.userId);
    await assertNewRecordId(ctx, a.recordId);

    const nextDueDate = deriveNextDueDate(a.testDate, asset.testIntervalMonths);
    const before = ttAssetSnapshot(asset);
    await insertRecord(ctx, a, { testedById, verdicts, nextDueDate, profileId: profile?.id });
    await insertSubTests(ctx, a.recordId, a.subTests ?? [], verdicts.subResults, a.now);
    await ctx.db.patch(asset._id, assetScalarsPatch(a, asset, nextDueDate, profile?.id));

    // Failure actions (only on a FAIL result — the DERIVED one).
    const failure = verdicts.result === "FAIL" ? await applyFailureAction(ctx, a, asset, actor.userId) : NO_FAILURE;

    // Recompute the asset status from the FRESH state (ctx.db sees our writes).
    await recalculateStatus(ctx, a.testTagAssetId, a.orgId, a.now);
    const fresh = await ctx.db.get(asset._id);

    const details: TestTagSaveDetails = {
      kind: "testTagRecord", result: verdicts.result, testerName: a.testerName,
      ...(profile ? { profileId: profile.id } : {}),
      // The SERVER clock (Date.now() is fine in a mutation): the Undo window is measured on it.
      serverSavedAt: Date.now(),
      before, after: ttAssetSnapshot(fresh ?? asset),
      ...failure,
    };
    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "CREATE",
      entityType: "testTagRecord",
      entityId: a.recordId,
      entityName: asset.testTagId ?? "",
      userId: actor.userId,
      userName: actor.userName,
      summary: `Recorded ${verdicts.result} test for ${asset.testTagId}`,
      details,
      createdAt: a.now,
    });

    return { id: a.recordId, nextDueDate, result: verdicts.result };
  },
});

async function requireTtAssetInOrg(ctx: MutationCtx, orgId: string, id: string): Promise<Doc<"testTagAssets">> {
  const asset = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  if (!asset || asset.organizationId !== orgId) throw new ConvexError("Test tag asset not found");
  return asset;
}

/** The record lands at the client-minted id — a replay hard-fails. */
async function assertNewRecordId(ctx: MutationCtx, recordId: string): Promise<void> {
  const dup = await ctx.db.query("testTagRecords").withIndex("by_cuid", (q) => q.eq("id", recordId)).unique();
  if (dup) throw new ConvexError("Test tag record already exists");
}

/** The parent asset's scalars after a test (status is recalculated afterwards). */
function assetScalarsPatch(
  a: { testDate: number; now: number; outletCount?: number; testProfileId?: string },
  asset: Doc<"testTagAssets">,
  nextDueDate: number,
  resolvedProfileId: string | undefined,
): Partial<Doc<"testTagAssets">> {
  const patch: Partial<Doc<"testTagAssets">> = { lastTestDate: a.testDate, nextDueDate, updatedAt: a.now };
  if (a.outletCount) patch.outletCount = a.outletCount;
  // Pin the profile only when the caller confirmed the RESOLVED one (profileForTest
  // rejects any other), never a caller-chosen id.
  if (!asset.testProfileId && a.testProfileId && resolvedProfileId === a.testProfileId) patch.testProfileId = resolvedProfileId;
  return patch;
}

/** A test can't be dated in the future (a little clock skew allowed). */
const TEST_DATE_SKEW_MS = 5 * 60 * 1000;

/**
 * Outlets (sub-test profiles): a profile that requires them needs 1–50, and the outlet
 * count the asset keeps must be the number actually tested.
 */
function assertOutletCountBounds(count: number | undefined): void {
  if (count === undefined) return;
  if (!Number.isInteger(count) || count < 1 || count > MAX_SUB_TESTS) {
    throw new ConvexError(`Outlet count must be a whole number from 1 to ${MAX_SUB_TESTS}`);
  }
}

function assertOutlets(a: { outletCount?: number; subTests?: SubTestInput[] }, profile: Doc<"testProfiles"> | null): void {
  const n = a.subTests?.length ?? 0;
  assertOutletCountBounds(a.outletCount);
  if (profile?.requiresSubTests && n < 1) throw new ConvexError("Test at least one outlet");
  if ((n > 0 || a.outletCount !== undefined) && a.outletCount !== n) {
    throw new ConvexError("The outlet count must match the outlets tested");
  }
}

/** Tester defaults to the verified actor; a supplied non-self tester must be a member. */
async function resolveTester(ctx: MutationCtx, orgId: string, testedById: string | undefined, actorUserId: string): Promise<string> {
  const id = testedById || actorUserId;
  if (id === actorUserId) return id;
  const member = await ctx.db
    .query("members")
    .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", id))
    .first();
  if (!member) throw new ConvexError("Selected tester is not a member of this organisation");
  return id;
}

type CreateArgs = {
  orgId: string; recordId: string; testTagAssetId: string; testDate: number; testerName: string; now: number;
  failureAction?: Doc<"testTagRecords">["failureAction"]; failureNotes?: string;
  maintenanceId?: string; maintenanceLinkId?: string;
} & Record<string, unknown>;

async function insertRecord(
  ctx: MutationCtx,
  a: CreateArgs,
  d: { testedById: string; verdicts: { visual: "PASS" | "FAIL"; result: "PASS" | "FAIL" }; nextDueDate: number; profileId?: string },
): Promise<void> {
  const optional = definedOnly({
    testProfileId: d.profileId,
    visualCordCondition: a.visualCordCondition, visualPlugCondition: a.visualPlugCondition,
    visualHousingCondition: a.visualHousingCondition, visualSwitchCondition: a.visualSwitchCondition,
    visualVentsUnobstructed: a.visualVentsUnobstructed, visualCordGrip: a.visualCordGrip,
    visualEarthPin: a.visualEarthPin, visualMarkingsLegible: a.visualMarkingsLegible,
    visualNoModifications: a.visualNoModifications, visualNotes: a.visualNotes,
    earthContinuityReading: a.earthContinuityReading, insulationReading: a.insulationReading,
    insulationTestVoltage: a.insulationTestVoltage, leakageCurrentReading: a.leakageCurrentReading,
    rcdTripTimeReading: a.rcdTripTimeReading,
    rcdTripCurrentResult: a.rcdTripCurrentResult, rcdTripCurrentReading: a.rcdTripCurrentReading,
    rcdPushButtonResult: a.rcdPushButtonResult,
    microwaveLeakageResult: a.microwaveLeakageResult, microwaveLeakageReading: a.microwaveLeakageReading,
    functionalTestNotes: a.functionalTestNotes, failureNotes: a.failureNotes,
  });
  const na = (x: unknown) => (x as Doc<"testTagRecords">["earthContinuityResult"]) || "NOT_APPLICABLE";
  await ctx.db.insert("testTagRecords", {
    id: a.recordId,
    organizationId: a.orgId,
    testTagAssetId: a.testTagAssetId,
    testDate: a.testDate,
    testedById: d.testedById,
    testerName: a.testerName,
    result: d.verdicts.result,
    visualInspectionResult: d.verdicts.visual,
    equipmentClassTested: (a.equipmentClassTested as Doc<"testTagRecords">["equipmentClassTested"]) || "CLASS_I",
    testMethod: (a.testMethod as Doc<"testTagRecords">["testMethod"]) || "INSULATION_RESISTANCE",
    earthContinuityResult: na(a.earthContinuityResult),
    insulationResult: na(a.insulationResult),
    leakageCurrentResult: na(a.leakageCurrentResult),
    polarityResult: na(a.polarityResult),
    rcdTripTimeResult: na(a.rcdTripTimeResult),
    functionalTestResult: na(a.functionalTestResult),
    // A failure action only means anything on a (derived) FAIL.
    failureAction: d.verdicts.result === "FAIL" ? a.failureAction || "NONE" : "NONE",
    nextDueDate: d.nextDueDate,
    createdAt: a.now,
    updatedAt: a.now,
    ...optional,
  });
}

/** Insert sub-tests (each at its client-minted id, idempotent per id) with DERIVED results. */
async function insertSubTests(ctx: MutationCtx, recordId: string, subTests: SubTestInput[], results: ("PASS" | "FAIL")[], now: number): Promise<void> {
  for (const [i, st] of subTests.entries()) {
    const stDup = await ctx.db
      .query("subTestRecords")
      .withIndex("by_cuid", (q) => q.eq("id", st.id))
      .unique();
    if (stDup) {
      // Same-record retry → idempotent skip. A collision with a DIFFERENT record's
      // sub-test (subTestRecords has no org column; ownership is via the parent) is a
      // deliberate foreign id — reject rather than silently drop the caller's sub-test.
      if (stDup.testTagRecordId !== recordId) throw new ConvexError("Sub-test id collision");
      continue;
    }
    await ctx.db.insert("subTestRecords", {
      id: st.id,
      testTagRecordId: recordId,
      label: st.label,
      sortOrder: st.sortOrder,
      result: results[i],
      earthContinuityResult: st.earthContinuityResult || "NOT_APPLICABLE",
      insulationResult: st.insulationResult || "NOT_APPLICABLE",
      leakageCurrentResult: st.leakageCurrentResult || "NOT_APPLICABLE",
      polarityResult: st.polarityResult || "NOT_APPLICABLE",
      createdAt: now,
      ...definedOnly({
        earthContinuityReading: st.earthContinuityReading,
        insulationReading: st.insulationReading,
        leakageCurrentReading: st.leakageCurrentReading,
        notes: st.notes,
      }),
    });
  }
}

type FailureOutcome = Pick<TestTagSaveDetails, "inventory" | "createdMaintenanceId" | "referralMaintenanceId" | "createdLinkId">;
const NO_FAILURE: FailureOutcome = { inventory: null, createdMaintenanceId: null, referralMaintenanceId: null, createdLinkId: null };

/** Apply the chosen failure action; returns what it created/changed, for the Undo. */
async function applyFailureAction(ctx: MutationCtx, a: CreateArgs, asset: Doc<"testTagAssets">, actorUserId: string): Promise<FailureOutcome> {
  if (a.failureAction === "REMOVED_FROM_SERVICE") {
    await ctx.db.patch(asset._id, { status: "FAILED" });
  } else if (a.failureAction === "DISPOSED") {
    await ctx.db.patch(asset._id, { status: "RETIRED", isActive: false });
  } else if (a.failureAction === "REFERRED_TO_ELECTRICIAN" && asset.assetId) {
    return await referToElectrician(ctx, a, asset, actorUserId);
  }
  return NO_FAILURE;
}

/** The referral maintenance record; returns whether THIS call created it. */
async function ensureReferralRecord(ctx: MutationCtx, a: CreateArgs, asset: Doc<"testTagAssets">, maintenanceId: string, actorUserId: string): Promise<boolean> {
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
  if (mDup && mDup.organizationId !== a.orgId) throw new ConvexError("Maintenance record id already exists");
  if (!mDup) {
    await ctx.db.insert("maintenanceRecords", {
      id: maintenanceId,
      organizationId: a.orgId,
      type: "REPAIR",
      status: "SCHEDULED",
      title: `Electrician referral — ${asset.testTagId}`,
      description,
      reportedById: actorUserId,
      createdAt: a.now,
      updatedAt: a.now,
    });
  }
  return !mDup;
}

async function referToElectrician(ctx: MutationCtx, a: CreateArgs, asset: Doc<"testTagAssets">, actorUserId: string): Promise<FailureOutcome> {
  const maintenanceId = a.maintenanceId || createId();
  const created = await ensureReferralRecord(ctx, a, asset, maintenanceId, actorUserId);
  // Maintenance→asset link (Convex-only join; parent-scoped, no org column).
  // Idempotent on (maintenanceRecordId, assetId) — mirrors createMaintenanceAssetLinks.
  const existingLink = await ctx.db
    .query("maintenanceRecordAssets")
    .withIndex("by_maintenanceRecordId_assetId", (q) => q.eq("maintenanceRecordId", maintenanceId).eq("assetId", asset.assetId!))
    .first();
  let createdLinkId: string | null = null;
  if (!existingLink) {
    createdLinkId = a.maintenanceLinkId || createId();
    // by_cuid is GLOBAL and the link has no org column: a replayed / foreign link id
    // must not land a second row under that id (the incident + PM cores reject it too).
    const linkDup = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", createdLinkId!)).first();
    if (linkDup) throw new ConvexError("Maintenance link id already exists");
    await ctx.db.insert("maintenanceRecordAssets", { id: createdLinkId, maintenanceRecordId: maintenanceId, assetId: asset.assetId! });
  }
  // Mark the linked INVENTORY asset in-maintenance (per-row org re-check).
  const invAsset = await ctx.db
    .query("assets")
    .withIndex("by_cuid", (q) => q.eq("id", asset.assetId!))
    .unique();
  if (!invAsset || invAsset.organizationId !== a.orgId) throw new ConvexError("Linked asset not found");
  const invBefore = invAssetSnapshot(invAsset);
  // A retired unit keeps RETIRED (no status writer reinstates it); a referral can still be recorded against it.
  const referredStatus = nextStatusUnlessRetired(invAsset.status, "IN_MAINTENANCE");
  await ctx.db.patch(invAsset._id, { status: referredStatus, updatedAt: a.now });
  return {
    inventory: { id: invAsset.id, before: invBefore, after: { status: referredStatus, updatedAt: a.now } },
    createdMaintenanceId: created ? maintenanceId : null,
    referralMaintenanceId: maintenanceId,
    createdLinkId,
  };
}

/**
 * Recompute + patch a T&T asset's status from its latest record + due dates. Port
 * of `recalculateStatus` (src/server/test-tag-records.ts) reading Convex directly.
 * Re-reads the asset so it observes the failure-action patches.
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

/**
 * The EXACT reverse of one `createNative` (Phase 16, overseer Q2/Q10/Q13), for the
 * Scan page's one Undo closure. Takes only ids: the record, its asset's prior fields
 * and anything the failure action changed come from the save's own server-written
 * audit row. Refuses — changing nothing — outside the 10-minute server-clock window,
 * for anyone but the tester who saved it, a second time, when the item was tested
 * again since, or when the T&T asset / flagged inventory asset / referral changed
 * since. Otherwise deletes the record + its sub-tests (+ the referral it opened),
 * restores every snapshotted field exactly (absent ones unset) and appends an UNDO
 * activity row — the compliance trace that a record existed and was withdrawn.
 */
export const undoCreateNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    orgId: v.string(),
    recordId: v.string(),
    auditId: v.string(),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "testTag");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "testTag", "create");
    const actor = await resolveActor(ctx, a.actor);

    // The forward audit row first: it is what proves author / once / window (a second
    // undo finds its own UNDO row here, before the deleted record could be looked up).
    const { forward, details } = await loadUndoableTestSave(ctx, { orgId: a.orgId, recordId: a.recordId, actorUserId: actor.userId, serverNow: Date.now() });
    const record = await ctx.db.query("testTagRecords").withIndex("by_cuid", (q) => q.eq("id", a.recordId)).first();
    if (!record || record.organizationId !== a.orgId) throw new ConvexError("Test record not found");
    await requireNewestRecord(ctx, a.orgId, record);
    const asset = await requireUntouchedTtAsset(ctx, a.orgId, record, details);

    await deleteRecordWithSubTests(ctx, record);
    await reverseFailureAction(ctx, a.orgId, record, details);
    await ctx.db.patch(asset._id, ttAssetRestorePatch(details.before));

    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "UNDO", entityType: "testTagRecord",
      entityId: record.id, entityName: forward.entityName, userId: actor.userId, userName: actor.userName,
      summary: `Undid ${details.result} test for ${asset.testTagId} (record withdrawn)`,
      details: { undoOf: forward.id, result: details.result, testDate: record.testDate }, createdAt: a.now,
    });
    return { ok: true };
  },
});

/** The record's T&T asset (org-checked), still exactly as the save left it. */
async function requireUntouchedTtAsset(ctx: MutationCtx, orgId: string, record: Doc<"testTagRecords">, details: TestTagSaveDetails) {
  const asset = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", record.testTagAssetId)).first();
  if (!asset || asset.organizationId !== orgId) throw new ConvexError("Test tag asset not found");
  if (!sameSnapshot(ttAssetSnapshot(asset), details.after)) throw new ConvexError("The item changed since: this test can't be undone");
  return asset;
}

/**
 * Undo what the failure action did: the referral it opened (only if untouched), the
 * link it added, the inventory asset it flagged. A refusal here throws, and the
 * mutation is one transaction, so nothing the Undo already did is kept.
 */
async function reverseFailureAction(ctx: MutationCtx, orgId: string, record: Doc<"testTagRecords">, details: TestTagSaveDetails): Promise<void> {
  const inventory = details.inventory ? await requireUntouchedInventory(ctx, orgId, details.inventory) : null;
  const created = details.createdMaintenanceId ? [details.createdMaintenanceId] : [];
  const maintenance = await requireUntouchedMaintenance(ctx, orgId, created, record.createdAt);
  for (const m of maintenance) await deleteMaintenanceWithLinks(ctx, m);
  if (created.length === 0 && details.createdLinkId) await deleteAddedLink(ctx, orgId, details);
  if (inventory && details.inventory) {
    const b = details.inventory.before;
    await ctx.db.patch(inventory._id, { status: (b.status ?? undefined) as Doc<"assets">["status"], updatedAt: b.updatedAt ?? undefined });
  }
}

async function deleteRecordWithSubTests(ctx: MutationCtx, record: Doc<"testTagRecords">): Promise<void> {
  const subs = await ctx.db
    .query("subTestRecords")
    .withIndex("by_testTagRecordId", (q) => q.eq("testTagRecordId", record.id))
    .take(MAX_SUB_TESTS + 1);
  for (const s of subs) await ctx.db.delete(s._id);
  await ctx.db.delete(record._id);
}

/**
 * The link the save added to a PRE-EXISTING same-org maintenance record. Found by the
 * (maintenance record, inventory asset) pair the save recorded — never by a bare link id
 * on the global index — after proving the record is in this org and the row there is
 * the one this save inserted.
 */
async function deleteAddedLink(ctx: MutationCtx, orgId: string, details: TestTagSaveDetails): Promise<void> {
  const maintenanceId = details.referralMaintenanceId;
  const assetId = details.inventory?.id;
  if (!maintenanceId || !assetId) throw new ConvexError("This test's referral link can't be undone");
  const m = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", maintenanceId)).first();
  if (!m || m.organizationId !== orgId) throw new ConvexError("This test's referral can't be found");
  const link = await ctx.db
    .query("maintenanceRecordAssets")
    .withIndex("by_maintenanceRecordId_assetId", (q) => q.eq("maintenanceRecordId", maintenanceId).eq("assetId", assetId))
    .first();
  if (link && link.id === details.createdLinkId) await ctx.db.delete(link._id);
}

// See docs/designs/api-mcp-reimplementation.md §9 for the classification rubric.
// createNative isn't a plain "create a record" op: on a FAIL result its
// failureAction branch can flip the linked equipment to FAILED, or DISPOSED
// (status: RETIRED, isActive: false — an archive), or open a maintenance
// referral — real, physical-compliance-affecting side effects on top of the
// insert. `high`, matching the delete/archive rule rather than the ordinary
// `medium` a bare create would get.
export const agentOps: AgentOpsAnnotations = {
  createNative: { danger: "high" },
  // Deletes a compliance record (AS/NZS 3760) and rewrites the item's status/due
  // dates: a delete, so "high" (overseer Q13).
  undoCreateNative: { danger: "high" },
};
