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
 * The filter predicates (`assetMatchesFilters` / `recordMatchesFilters` for the
 * reports; `listAssetMatchesFilters` + `compareTestTagAssets` for the paginated
 * registry list) are pure re-implementations of the old Prisma `where` / `orderBy`
 * builders, unit-tested with fixtures.
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

/** All test records for a single test tag asset (unsorted — callers sort). */
export async function getTestTagRecordsByAssetId(testTagAssetId: string): Promise<TTRecord[]> {
  const rows = (await (await getConvexClient()).query(api.testTagRecords.listByAssetId, {
    testTagAssetId,
  })) as RawTTRecord[];
  return rows.map(mapTTRecord);
}

/** Look up a test tag asset by org + human testTagId (includes retired). */
export async function getTestTagAssetByTestTagId(
  orgId: string,
  testTagId: string,
): Promise<TTAsset | null> {
  const row = (await (await getConvexClient()).query(api.testTagAssets.getByTestTagId, {
    orgId,
    testTagId,
  })) as RawTTAsset | null;
  return row ? mapTTAsset(row) : null;
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

// ─── Full TestProfile (the `testProfile: true` include in lookupTestTagAsset) ──

type RawTestProfile = Doc<"testProfiles">;

export interface TestProfile {
  id: string;
  organizationId: string;
  name: string;
  equipmentClass: string;
  applianceType: string;
  visualChecks: unknown;
  electricalTests: unknown;
  thresholds: unknown;
  requiresSubTests: boolean;
  defaultSubTestCount: number;
  subTestLabel: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export function mapTestProfile(d: RawTestProfile): TestProfile {
  return {
    id: d.id,
    organizationId: d.organizationId,
    name: d.name,
    equipmentClass: req(d.equipmentClass),
    applianceType: req(d.applianceType),
    visualChecks: d.visualChecks,
    electricalTests: d.electricalTests,
    thresholds: d.thresholds,
    requiresSubTests: d.requiresSubTests ?? false,
    defaultSubTestCount: req(d.defaultSubTestCount),
    subTestLabel: req(d.subTestLabel),
    isDefault: d.isDefault ?? false,
    isActive: d.isActive ?? true,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

/** Full TestProfile by id (replaces Prisma `testProfile: true`). Null if absent. */
export async function getFullTestProfileById(id: string): Promise<TestProfile | null> {
  const row = (await (await getConvexClient()).query(api.testProfiles.getById, { id })) as RawTestProfile | null;
  return row ? mapTestProfile(row) : null;
}

// ─── List filter + sort (replicate getTestTagAssets `where` + `orderBy`) ──────

/** Filters accepted by `getTestTagAssets` (the paginated registry list). */
export interface TestTagListFilters {
  search?: string;
  status?: string;
  equipmentClass?: string;
  applianceType?: string;
  assetLinkType?: "all" | "serialized" | "bulk" | "standalone";
  /** `isActive` is a list PARAMETER (defaults to true at the call site). */
  isActive: boolean;
}

/**
 * Pure re-implementation of the `getTestTagAssets` Prisma `where`. Org scoping is
 * applied at fetch. Unlike the report-level `assetMatchesFilters`, `isActive` is a
 * PARAMETER here (it can be `false` to list retired items), and status / class /
 * type are single EXACT matches (not IN). Search is a case-insensitive OR over
 * testTagId / description / serialNumber / make / modelName. Pure → unit-tested.
 */
export function listAssetMatchesFilters(item: TTAsset, filters: TestTagListFilters): boolean {
  if (item.isActive !== filters.isActive) return false;
  if (filters.status && item.status !== filters.status) return false;
  if (filters.equipmentClass && item.equipmentClass !== filters.equipmentClass) return false;
  if (filters.applianceType && item.applianceType !== filters.applianceType) return false;

  if (filters.assetLinkType === "serialized") {
    if (item.assetId == null) return false;
  } else if (filters.assetLinkType === "bulk") {
    if (item.bulkAssetId == null) return false;
    if (item.assetId != null) return false;
  } else if (filters.assetLinkType === "standalone") {
    if (item.assetId != null) return false;
    if (item.bulkAssetId != null) return false;
  }

  if (filters.search) {
    const q = filters.search;
    const hit =
      insIncludes(item.testTagId, q) ||
      insIncludes(item.description, q) ||
      insIncludes(item.serialNumber, q) ||
      insIncludes(item.make, q) ||
      insIncludes(item.modelName, q);
    if (!hit) return false;
  }

  return true;
}

// Postgres enums sort by DECLARED order (NOT alphabetical). Replicate via rank
// maps built from prisma/schema.prisma declaration order.
const STATUS_RANK: Record<string, number> = {
  NOT_YET_TESTED: 0, CURRENT: 1, DUE_SOON: 2, OVERDUE: 3, FAILED: 4, RETIRED: 5,
};
const EQUIPMENT_CLASS_RANK: Record<string, number> = {
  CLASS_I: 0, CLASS_II: 1, CLASS_II_DOUBLE_INSULATED: 2, LEAD_CORD_ASSEMBLY: 3,
};
const APPLIANCE_TYPE_RANK: Record<string, number> = {
  APPLIANCE: 0, CORD_SET: 1, EXTENSION_LEAD: 2, POWER_BOARD: 3,
  RCD_PORTABLE: 4, RCD_FIXED: 5, THREE_PHASE: 6, MICROWAVE: 7, OTHER: 8,
};

const ENUM_RANK: Record<string, Record<string, number>> = {
  status: STATUS_RANK,
  equipmentClass: EQUIPMENT_CLASS_RANK,
  applianceType: APPLIANCE_TYPE_RANK,
};

// Columns that are nullable in Prisma — these honour Postgres NULL ordering.
const NULLABLE_KEYS = new Set([
  "make", "modelName", "serialNumber", "location", "nextDueDate", "lastTestDate",
]);

// Sort keys we actually support (others fall back to testTagId asc). Mirrors the
// scalar columns the registry UI exposes as sortBy.
const SORTABLE_KEYS = new Set<keyof TTAsset>([
  "testTagId", "description", "status", "equipmentClass", "applianceType",
  "make", "modelName", "serialNumber", "location", "testIntervalMonths",
  "nextDueDate", "lastTestDate", "outletCount", "createdAt", "updatedAt",
]);

function compareValues(a: unknown, b: unknown, key: string, order: "asc" | "desc"): number {
  const dir = order === "desc" ? -1 : 1;

  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) {
    if (aNull && bNull) return 0;
    if (NULLABLE_KEYS.has(key)) {
      // Postgres: ASC = NULLS LAST, DESC = NULLS FIRST.
      if (order === "asc") return aNull ? 1 : -1;
      return aNull ? -1 : 1;
    }
    // Non-nullable column with an (unexpected) null — keep it deterministic.
    return aNull ? 1 : -1;
  }

  const rank = ENUM_RANK[key];
  if (rank) {
    const ar = rank[a as string] ?? Number.MAX_SAFE_INTEGER;
    const br = rank[b as string] ?? Number.MAX_SAFE_INTEGER;
    return (ar - br) * dir;
  }

  if (a instanceof Date && b instanceof Date) {
    return (a.getTime() - b.getTime()) * dir;
  }
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * dir;
  }
  return String(a).localeCompare(String(b)) * dir;
}

/**
 * Pure comparator replicating `orderBy: { [sortBy]: sortOrder }`, default
 * `testTagId` asc. Handles Postgres NULL ordering for nullable columns, enum
 * DECLARED-order for status / equipmentClass / applianceType, and falls back to
 * `testTagId` asc for unknown sort keys. Pure → unit-tested.
 */
export function compareTestTagAssets(
  a: TTAsset,
  b: TTAsset,
  sortBy: string,
  sortOrder: "asc" | "desc",
): number {
  const key = (SORTABLE_KEYS.has(sortBy as keyof TTAsset) ? sortBy : "testTagId") as keyof TTAsset;
  const primary = compareValues(a[key], b[key], key, sortOrder);
  if (primary !== 0) return primary;
  // Stable tiebreak on testTagId asc (deterministic ordering for the page slice).
  if (key !== "testTagId") return compareValues(a.testTagId, b.testTagId, "testTagId", "asc");
  return 0;
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
