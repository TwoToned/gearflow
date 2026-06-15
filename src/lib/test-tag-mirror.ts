import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Test & Tag domain dual-write (Phase 6 decommission groundwork).
 *
 * Mirrors the three Test & Tag tables — testTagAsset, testTagRecord, subTestRecord
 * (Convex tables "testTagAssets", "testTagRecords", "subTestRecords") — into Convex
 * so the reactive registry can resolve them without a cross-domain Prisma join.
 *
 * Convex calls cannot run inside a Prisma `$transaction`; every caller mirrors
 * AFTER the tx commits, using the row(s)/id(s) captured from the tx. For deletes,
 * capture the id before the tx and mirror the remove after commit.
 *
 * Always `ConvexError` on the Convex side; `createIfMissing` is idempotent. See
 * FEATUREDOCS/54 and the line-item-unit-mirror / asset-bulk-child-mirror siblings.
 */

/** Scalar columns the Convex testTagAssets create/update validators accept. */
const TEST_TAG_ASSET_KEYS = new Set([
  "id",
  "organizationId",
  "testTagId",
  "description",
  "equipmentClass",
  "applianceType",
  "make",
  "modelName",
  "serialNumber",
  "location",
  "testIntervalMonths",
  "status",
  "lastTestDate",
  "nextDueDate",
  "notes",
  "assetId",
  "bulkAssetId",
  "testProfileId",
  "outletCount",
  "isActive",
  "createdAt",
  "updatedAt",
]);

/** Scalar columns the Convex testTagRecords create/update validators accept. */
const TEST_TAG_RECORD_KEYS = new Set([
  "id",
  "organizationId",
  "testTagAssetId",
  "testProfileId",
  "testDate",
  "testedById",
  "testerName",
  "result",
  "visualInspectionResult",
  "visualCordCondition",
  "visualPlugCondition",
  "visualHousingCondition",
  "visualSwitchCondition",
  "visualVentsUnobstructed",
  "visualCordGrip",
  "visualEarthPin",
  "visualMarkingsLegible",
  "visualNoModifications",
  "visualNotes",
  "equipmentClassTested",
  "testMethod",
  "earthContinuityResult",
  "earthContinuityReading",
  "insulationResult",
  "insulationReading",
  "insulationTestVoltage",
  "leakageCurrentResult",
  "leakageCurrentReading",
  "polarityResult",
  "rcdTripTimeResult",
  "rcdTripTimeReading",
  "functionalTestResult",
  "functionalTestNotes",
  "failureAction",
  "failureNotes",
  "nextDueDate",
  "createdAt",
  "updatedAt",
]);

/** Scalar columns the Convex subTestRecords create/update validators accept. */
const SUB_TEST_RECORD_KEYS = new Set([
  "id",
  "testTagRecordId",
  "label",
  "sortOrder",
  "result",
  "earthContinuityResult",
  "earthContinuityReading",
  "insulationResult",
  "insulationReading",
  "leakageCurrentResult",
  "leakageCurrentReading",
  "polarityResult",
  "notes",
  "createdAt",
]);

function strip(
  row: Record<string, unknown>,
  keys: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (keys.has(k)) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// testTagAsset
// ---------------------------------------------------------------------------

/** Mirror a newly-created test-tag asset into Convex (idempotent). */
export async function mirrorTestTagAssetCreate(
  row: Record<string, unknown>,
): Promise<void> {
  const client = await getConvexClient();
  const doc = strip(toConvexDoc(row), TEST_TAG_ASSET_KEYS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.mutation(api.testTagAssets.createIfMissing, doc as any);
}

/** Patch an existing test-tag asset in Convex (scalar columns only). */
export async function patchTestTagAssetInConvex(
  id: string,
  row: Record<string, unknown>,
): Promise<void> {
  const client = await getConvexClient();
  const doc = strip(toConvexDoc(row), TEST_TAG_ASSET_KEYS);
  const { id: _id, ...rest } = doc;
  await client.mutation(api.testTagAssets.update, {
    id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patch: rest as any,
  });
}

/** Remove a test-tag asset from Convex (tolerant — remove throws ConvexError if absent). */
export async function removeTestTagAssetFromConvex(id: string): Promise<void> {
  const client = await getConvexClient();
  await client.mutation(api.testTagAssets.remove, { id });
}

// ---------------------------------------------------------------------------
// testTagRecord
// ---------------------------------------------------------------------------

/** Mirror a newly-created test-tag record into Convex (idempotent). */
export async function mirrorTestTagRecordCreate(
  row: Record<string, unknown>,
): Promise<void> {
  const client = await getConvexClient();
  const doc = strip(toConvexDoc(row), TEST_TAG_RECORD_KEYS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.mutation(api.testTagRecords.createIfMissing, doc as any);
}

/** Patch an existing test-tag record in Convex (scalar columns only). */
export async function patchTestTagRecordInConvex(
  id: string,
  row: Record<string, unknown>,
): Promise<void> {
  const client = await getConvexClient();
  const doc = strip(toConvexDoc(row), TEST_TAG_RECORD_KEYS);
  const { id: _id, ...rest } = doc;
  await client.mutation(api.testTagRecords.update, {
    id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patch: rest as any,
  });
}

/** Remove a test-tag record from Convex (tolerant — remove throws ConvexError if absent). */
export async function removeTestTagRecordFromConvex(id: string): Promise<void> {
  const client = await getConvexClient();
  await client.mutation(api.testTagRecords.remove, { id });
}

// ---------------------------------------------------------------------------
// subTestRecord
// ---------------------------------------------------------------------------

/** Mirror a newly-created sub-test record into Convex (idempotent). */
export async function mirrorSubTestRecordCreate(
  row: Record<string, unknown>,
): Promise<void> {
  const client = await getConvexClient();
  const doc = strip(toConvexDoc(row), SUB_TEST_RECORD_KEYS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.mutation(api.subTestRecords.createIfMissing, doc as any);
}

/** Patch an existing sub-test record in Convex (scalar columns only). */
export async function patchSubTestRecordInConvex(
  id: string,
  row: Record<string, unknown>,
): Promise<void> {
  const client = await getConvexClient();
  const doc = strip(toConvexDoc(row), SUB_TEST_RECORD_KEYS);
  const { id: _id, ...rest } = doc;
  await client.mutation(api.subTestRecords.update, {
    id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patch: rest as any,
  });
}

/** Remove a sub-test record from Convex (tolerant — remove throws ConvexError if absent). */
export async function removeSubTestRecordFromConvex(id: string): Promise<void> {
  const client = await getConvexClient();
  await client.mutation(api.subTestRecords.remove, { id });
}
