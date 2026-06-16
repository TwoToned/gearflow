import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { ReportFilters } from "@/lib/test-tag-report-types";

/**
 * Server-side read helpers for the Test & Tag domain (Phase A read-rewiring of
 * the Convex domain-only decommission — see docs/designs/convex-domain-only-decommission.md).
 *
 * `testTagAsset`, `testTagRecord`, and `subTestRecord` are dual-written
 * (Prisma FK anchor + Convex reactive doc). These helpers read the Convex copy
 * and shape it back into the Prisma-row form the reports expect: Convex stores
 * dates as epoch-ms numbers and drops null optionals, so the mappers convert
 * date fields to `Date` and normalise absent optionals to `null`, matching what
 * `serialize()` produced from Prisma rows before the cutover.
 *
 * Cross-domain joins are composed by the caller: asset/bulkAsset/testProfile
 * come from Convex (their own read helpers), and `testedBy` (a Better Auth
 * `User`) stays on Prisma forever — resolve tester names via `getUserNameMap`.
 *
 * The filter predicates (`assetMatchesFilters` / `recordMatchesFilters`) are pure
 * re-implementations of the old Prisma `where` builders, unit-tested with fixtures.
 */

type RawTTAsset = Doc<"testTagAssets">;
type RawTTRecord = Doc<"testTagRecords">;
type RawSubTest = Doc<"subTestRecords">;

// ─── Mapped (Prisma-row-shaped) types ────────────────────────────────────────

export interface TTAsset {
  id: string;
  organizationId: string;
  testTagId: string;
  description: string;
  equipmentClass: string;
  applianceType: string;
  make: string | null;
  modelName: string | null;
  serialNumber: string | null;
  location: string | null;
  testIntervalMonths: number;
  status: string;
  lastTestDate: Date | null;
  nextDueDate: Date | null;
  notes: string | null;
  assetId: string | null;
  bulkAssetId: string | null;
  testProfileId: string | null;
  outletCount: number | null;
  isActive: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface SubTestRecord {
  id: string;
  testTagRecordId: string;
  label: string;
  sortOrder: number;
  result: string;
  earthContinuityResult: string;
  earthContinuityReading: number | null;
  insulationResult: string;
  insulationReading: number | null;
  leakageCurrentResult: string;
  leakageCurrentReading: number | null;
  polarityResult: string;
  notes: string | null;
  createdAt: Date | null;
}

export interface TTRecord {
  id: string;
  organizationId: string;
  testTagAssetId: string;
  testProfileId: string | null;
  testDate: Date;
  testedById: string;
  testerName: string;
  result: string;
  visualInspectionResult: string;
  visualCordCondition: boolean | null;
  visualPlugCondition: boolean | null;
  visualHousingCondition: boolean | null;
  visualSwitchCondition: boolean | null;
  visualVentsUnobstructed: boolean | null;
  visualCordGrip: boolean | null;
  visualEarthPin: boolean | null;
  visualMarkingsLegible: boolean | null;
  visualNoModifications: boolean | null;
  visualNotes: string | null;
  equipmentClassTested: string;
  testMethod: string;
  earthContinuityResult: string;
  earthContinuityReading: number | null;
  insulationResult: string;
  insulationReading: number | null;
  insulationTestVoltage: number | null;
  leakageCurrentResult: string;
  leakageCurrentReading: number | null;
  polarityResult: string;
  rcdTripTimeResult: string;
  rcdTripTimeReading: number | null;
  functionalTestResult: string;
  functionalTestNotes: string | null;
  failureAction: string;
  failureNotes: string | null;
  nextDueDate: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

// ─── Mappers (epoch-ms → Date, absent → null) ────────────────────────────────

const toDate = (v: number | undefined): Date | null => (typeof v === "number" ? new Date(v) : null);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
// Fields the Convex schema marks optional (Phase 1 generator) but the Prisma
// source requires and the backfill always copies — coerce to non-null.
const req = <T>(v: T | undefined): T => v as T;

export function mapTTAsset(d: RawTTAsset): TTAsset {
  return {
    id: d.id,
    organizationId: d.organizationId,
    testTagId: d.testTagId,
    description: d.description,
    equipmentClass: req(d.equipmentClass),
    applianceType: req(d.applianceType),
    make: orNull(d.make),
    modelName: orNull(d.modelName),
    serialNumber: orNull(d.serialNumber),
    location: orNull(d.location),
    testIntervalMonths: req(d.testIntervalMonths),
    status: req(d.status),
    lastTestDate: toDate(d.lastTestDate),
    nextDueDate: toDate(d.nextDueDate),
    notes: orNull(d.notes),
    assetId: orNull(d.assetId),
    bulkAssetId: orNull(d.bulkAssetId),
    testProfileId: orNull(d.testProfileId),
    outletCount: orNull(d.outletCount),
    isActive: d.isActive ?? true,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export function mapSubTest(d: RawSubTest): SubTestRecord {
  return {
    id: d.id,
    testTagRecordId: d.testTagRecordId,
    label: req(d.label),
    sortOrder: req(d.sortOrder),
    result: req(d.result),
    earthContinuityResult: req(d.earthContinuityResult),
    earthContinuityReading: orNull(d.earthContinuityReading),
    insulationResult: req(d.insulationResult),
    insulationReading: orNull(d.insulationReading),
    leakageCurrentResult: req(d.leakageCurrentResult),
    leakageCurrentReading: orNull(d.leakageCurrentReading),
    polarityResult: req(d.polarityResult),
    notes: orNull(d.notes),
    createdAt: toDate(d.createdAt),
  };
}

export function mapTTRecord(d: RawTTRecord): TTRecord {
  return {
    id: d.id,
    organizationId: d.organizationId,
    testTagAssetId: d.testTagAssetId,
    testProfileId: orNull(d.testProfileId),
    testDate: new Date(req(d.testDate)),
    testedById: req(d.testedById),
    testerName: req(d.testerName),
    result: req(d.result),
    visualInspectionResult: req(d.visualInspectionResult),
    visualCordCondition: orNull(d.visualCordCondition),
    visualPlugCondition: orNull(d.visualPlugCondition),
    visualHousingCondition: orNull(d.visualHousingCondition),
    visualSwitchCondition: orNull(d.visualSwitchCondition),
    visualVentsUnobstructed: orNull(d.visualVentsUnobstructed),
    visualCordGrip: orNull(d.visualCordGrip),
    visualEarthPin: orNull(d.visualEarthPin),
    visualMarkingsLegible: orNull(d.visualMarkingsLegible),
    visualNoModifications: orNull(d.visualNoModifications),
    visualNotes: orNull(d.visualNotes),
    equipmentClassTested: req(d.equipmentClassTested),
    testMethod: req(d.testMethod),
    earthContinuityResult: req(d.earthContinuityResult),
    earthContinuityReading: orNull(d.earthContinuityReading),
    insulationResult: req(d.insulationResult),
    insulationReading: orNull(d.insulationReading),
    insulationTestVoltage: orNull(d.insulationTestVoltage),
    leakageCurrentResult: req(d.leakageCurrentResult),
    leakageCurrentReading: orNull(d.leakageCurrentReading),
    polarityResult: req(d.polarityResult),
    rcdTripTimeResult: req(d.rcdTripTimeResult),
    rcdTripTimeReading: orNull(d.rcdTripTimeReading),
    functionalTestResult: req(d.functionalTestResult),
    functionalTestNotes: orNull(d.functionalTestNotes),
    failureAction: req(d.failureAction),
    failureNotes: orNull(d.failureNotes),
    nextDueDate: toDate(d.nextDueDate),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

export async function getTestTagAssetsByOrg(orgId: string): Promise<TTAsset[]> {
  const rows = (await (await getConvexClient()).query(api.testTagAssets.list, { orgId })) as RawTTAsset[];
  return rows.map(mapTTAsset);
}

export async function getTestTagAssetById(id: string): Promise<TTAsset | null> {
  const row = (await (await getConvexClient()).query(api.testTagAssets.getById, { id })) as RawTTAsset | null;
  return row ? mapTTAsset(row) : null;
}

export async function getTestTagRecordsByOrg(orgId: string): Promise<TTRecord[]> {
  const rows = (await (await getConvexClient()).query(api.testTagRecords.list, { orgId })) as RawTTRecord[];
  return rows.map(mapTTRecord);
}

/** Sub-test records for a set of test records, in one round trip, sorted by sortOrder. */
export async function getSubTestRecordsByRecordIds(recordIds: string[]): Promise<SubTestRecord[]> {
  if (recordIds.length === 0) return [];
  const rows = (await (await getConvexClient()).query(api.subTestRecords.listByRecordIds, {
    recordIds,
  })) as RawSubTest[];
  return rows.map(mapSubTest).sort((a, b) => a.sortOrder - b.sortOrder);
}

// ─── Pure filter predicates (replicate the old Prisma `where` builders) ───────

const insIncludes = (haystack: string | null | undefined, needle: string): boolean =>
  (haystack ?? "").toLowerCase().includes(needle.toLowerCase());

/**
 * Mirrors `buildAssetWhere`: org scoping is applied at fetch, so this covers
 * `isActive: true` + the status / class / type / linkType / location / search
 * filters. Pure → unit-tested.
 */
export function assetMatchesFilters(item: TTAsset, filters: ReportFilters): boolean {
  if (item.isActive !== true) return false;
  if (filters.statuses?.length && !filters.statuses.includes(item.status)) return false;
  if (filters.equipmentClasses?.length && !filters.equipmentClasses.includes(item.equipmentClass)) return false;
  if (filters.applianceTypes?.length && !filters.applianceTypes.includes(item.applianceType)) return false;

  if (filters.assetLinkType === "serialized") {
    if (item.assetId == null) return false;
  } else if (filters.assetLinkType === "bulk") {
    if (item.bulkAssetId == null) return false;
    if (item.assetId != null) return false;
  } else if (filters.assetLinkType === "standalone") {
    if (item.assetId != null) return false;
    if (item.bulkAssetId != null) return false;
  }

  if (filters.locations?.length) {
    if (item.location == null || !filters.locations.includes(item.location)) return false;
  }

  if (filters.searchQuery) {
    const q = filters.searchQuery;
    const hit =
      insIncludes(item.testTagId, q) ||
      insIncludes(item.description, q) ||
      insIncludes(item.make, q) ||
      insIncludes(item.modelName, q) ||
      insIncludes(item.serialNumber, q);
    if (!hit) return false;
  }

  return true;
}

/**
 * Mirrors `buildRecordWhere`: org scoping applied at fetch; covers testDate
 * range + result + testedBy filters. Pure → unit-tested.
 */
export function recordMatchesFilters(record: TTRecord, filters: ReportFilters): boolean {
  if (filters.dateFrom) {
    if (record.testDate.getTime() < new Date(filters.dateFrom).getTime()) return false;
  }
  if (filters.dateTo) {
    if (record.testDate.getTime() > new Date(filters.dateTo).getTime()) return false;
  }
  if (filters.results?.length && !filters.results.includes(record.result)) return false;
  if (filters.testedBy?.length && !filters.testedBy.includes(record.testedById)) return false;
  return true;
}

/** Test profiles for an org, keyed by cuid, reduced to `{ id, name }` for attach. */
export async function getTestProfileMap(orgId: string): Promise<Map<string, { id: string; name: string }>> {
  const rows = (await (await getConvexClient()).query(api.testProfiles.list, { orgId })) as Array<{
    id: string;
    name: string;
  }>;
  return new Map(rows.map((p) => [p.id, { id: p.id, name: p.name }]));
}

// ─── Tester (Better Auth User) name resolution — stays on Prisma forever ──────

/** Resolve `testedBy` user names by id. Users are auth-owned (Prisma), not Convex. */
export async function getUserNameMap(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { prisma } = await import("@/lib/prisma");
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}
