import { describe, it, expect } from "vitest";
import {
  assetMatchesFilters,
  recordMatchesFilters,
  listAssetMatchesFilters,
  compareTestTagAssets,
  mapTTAsset,
  mapTTRecord,
  mapSubTest,
  mapTestProfile,
  type TTAsset,
  type TTRecord,
} from "@/lib/test-tag-read";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function asset(overrides: Partial<TTAsset> = {}): TTAsset {
  return {
    id: "tt1",
    organizationId: "org1",
    testTagId: "TT-001",
    description: "Speaker",
    equipmentClass: "CLASS_I",
    applianceType: "APPLIANCE",
    make: "Acme",
    modelName: "X1",
    serialNumber: "SN1",
    location: "Warehouse A",
    testIntervalMonths: 12,
    status: "CURRENT",
    lastTestDate: new Date("2026-01-01"),
    nextDueDate: new Date("2027-01-01"),
    notes: null,
    assetId: null,
    bulkAssetId: null,
    testProfileId: null,
    outletCount: null,
    isActive: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function record(overrides: Partial<TTRecord> = {}): TTRecord {
  return {
    id: "r1",
    organizationId: "org1",
    testTagAssetId: "tt1",
    testProfileId: null,
    testDate: new Date("2026-06-01"),
    testedById: "user1",
    testerName: "Alice",
    result: "PASS",
    visualInspectionResult: "PASS",
    visualCordCondition: null,
    visualPlugCondition: null,
    visualHousingCondition: null,
    visualSwitchCondition: null,
    visualVentsUnobstructed: null,
    visualCordGrip: null,
    visualEarthPin: null,
    visualMarkingsLegible: null,
    visualNoModifications: null,
    visualNotes: null,
    equipmentClassTested: "CLASS_I",
    testMethod: "BOTH",
    earthContinuityResult: "PASS",
    earthContinuityReading: 0.1,
    insulationResult: "PASS",
    insulationReading: 250,
    insulationTestVoltage: 500,
    leakageCurrentResult: "PASS",
    leakageCurrentReading: 0.2,
    polarityResult: "PASS",
    rcdTripTimeResult: "NOT_APPLICABLE",
    rcdTripTimeReading: null,
    functionalTestResult: "PASS",
    functionalTestNotes: null,
    failureAction: "NONE",
    failureNotes: null,
    nextDueDate: new Date("2027-06-01"),
    createdAt: new Date("2026-06-01"),
    updatedAt: new Date("2026-06-01"),
    ...overrides,
  };
}

// ─── assetMatchesFilters ──────────────────────────────────────────────────────

describe("assetMatchesFilters", () => {
  it("excludes inactive items (buildAssetWhere always sets isActive:true)", () => {
    expect(assetMatchesFilters(asset({ isActive: false }), {})).toBe(false);
    expect(assetMatchesFilters(asset({ isActive: true }), {})).toBe(true);
  });

  it("filters by status / equipmentClass / applianceType (IN semantics)", () => {
    expect(assetMatchesFilters(asset({ status: "OVERDUE" }), { statuses: ["CURRENT"] })).toBe(false);
    expect(assetMatchesFilters(asset({ status: "OVERDUE" }), { statuses: ["OVERDUE", "FAILED"] })).toBe(true);
    expect(assetMatchesFilters(asset({ equipmentClass: "CLASS_II" }), { equipmentClasses: ["CLASS_I"] })).toBe(false);
    expect(assetMatchesFilters(asset({ applianceType: "POWER_BOARD" }), { applianceTypes: ["APPLIANCE"] })).toBe(false);
  });

  it("assetLinkType: serialized requires assetId", () => {
    expect(assetMatchesFilters(asset({ assetId: "a1" }), { assetLinkType: "serialized" })).toBe(true);
    expect(assetMatchesFilters(asset({ assetId: null }), { assetLinkType: "serialized" })).toBe(false);
  });

  it("assetLinkType: bulk requires bulkAssetId and no assetId", () => {
    expect(assetMatchesFilters(asset({ bulkAssetId: "b1", assetId: null }), { assetLinkType: "bulk" })).toBe(true);
    expect(assetMatchesFilters(asset({ bulkAssetId: "b1", assetId: "a1" }), { assetLinkType: "bulk" })).toBe(false);
    expect(assetMatchesFilters(asset({ bulkAssetId: null }), { assetLinkType: "bulk" })).toBe(false);
  });

  it("assetLinkType: standalone requires neither link", () => {
    expect(assetMatchesFilters(asset({ assetId: null, bulkAssetId: null }), { assetLinkType: "standalone" })).toBe(true);
    expect(assetMatchesFilters(asset({ assetId: "a1" }), { assetLinkType: "standalone" })).toBe(false);
    expect(assetMatchesFilters(asset({ bulkAssetId: "b1" }), { assetLinkType: "standalone" })).toBe(false);
  });

  it("filters by location (IN); null location never matches a location filter", () => {
    expect(assetMatchesFilters(asset({ location: "Truck 1" }), { locations: ["Warehouse A"] })).toBe(false);
    expect(assetMatchesFilters(asset({ location: "Warehouse A" }), { locations: ["Warehouse A"] })).toBe(true);
    expect(assetMatchesFilters(asset({ location: null }), { locations: ["Warehouse A"] })).toBe(false);
  });

  it("search is case-insensitive across testTagId/description/make/modelName/serialNumber", () => {
    expect(assetMatchesFilters(asset({ description: "Powered Speaker" }), { searchQuery: "speaker" })).toBe(true);
    expect(assetMatchesFilters(asset({ serialNumber: "ABC123" }), { searchQuery: "abc1" })).toBe(true);
    expect(assetMatchesFilters(asset({ make: null, modelName: null, serialNumber: null, description: "x", testTagId: "y" }), { searchQuery: "zzz" })).toBe(false);
  });

  it("combines filters with AND", () => {
    const item = asset({ status: "CURRENT", location: "Warehouse A", assetId: "a1" });
    expect(assetMatchesFilters(item, { statuses: ["CURRENT"], locations: ["Warehouse A"], assetLinkType: "serialized" })).toBe(true);
    expect(assetMatchesFilters(item, { statuses: ["CURRENT"], locations: ["Truck 1"] })).toBe(false);
  });

  it("empty filters match any active item", () => {
    expect(assetMatchesFilters(asset(), {})).toBe(true);
  });
});

// ─── recordMatchesFilters ─────────────────────────────────────────────────────

describe("recordMatchesFilters", () => {
  it("filters by testDate range (inclusive)", () => {
    const r = record({ testDate: new Date("2026-06-15") });
    expect(recordMatchesFilters(r, { dateFrom: "2026-06-01" })).toBe(true);
    expect(recordMatchesFilters(r, { dateFrom: "2026-07-01" })).toBe(false);
    expect(recordMatchesFilters(r, { dateTo: "2026-06-30" })).toBe(true);
    expect(recordMatchesFilters(r, { dateTo: "2026-06-01" })).toBe(false);
    expect(recordMatchesFilters(r, { dateFrom: "2026-06-01", dateTo: "2026-06-30" })).toBe(true);
  });

  it("filters by result and testedBy (IN)", () => {
    expect(recordMatchesFilters(record({ result: "FAIL" }), { results: ["PASS"] })).toBe(false);
    expect(recordMatchesFilters(record({ result: "FAIL" }), { results: ["FAIL"] })).toBe(true);
    expect(recordMatchesFilters(record({ testedById: "u2" }), { testedBy: ["u1"] })).toBe(false);
    expect(recordMatchesFilters(record({ testedById: "u2" }), { testedBy: ["u1", "u2"] })).toBe(true);
  });

  it("empty filters match any record", () => {
    expect(recordMatchesFilters(record(), {})).toBe(true);
  });
});

// ─── mappers (epoch-ms → Date, absent → null, required coerced) ────────────────

describe("mappers", () => {
  it("mapTTAsset converts dates and normalises absent optionals to null", () => {
    const m = mapTTAsset({
      id: "x", organizationId: "o", testTagId: "T", description: "D",
      equipmentClass: "CLASS_I", applianceType: "APPLIANCE", testIntervalMonths: 6,
      status: "CURRENT", isActive: true,
      lastTestDate: 1_700_000_000_000,
      // make/modelName/serialNumber/location/notes/assetId/... absent
    } as never);
    expect(m.lastTestDate).toBeInstanceOf(Date);
    expect(m.lastTestDate?.getTime()).toBe(1_700_000_000_000);
    expect(m.nextDueDate).toBeNull();
    expect(m.make).toBeNull();
    expect(m.assetId).toBeNull();
    expect(m.bulkAssetId).toBeNull();
    expect(m.status).toBe("CURRENT");
  });

  it("mapTTRecord converts testDate and keeps numeric readings", () => {
    const m = mapTTRecord({
      id: "r", organizationId: "o", testTagAssetId: "tt", testDate: 1_700_000_000_000,
      testedById: "u", testerName: "N", result: "PASS", visualInspectionResult: "PASS",
      equipmentClassTested: "CLASS_I", testMethod: "BOTH",
      earthContinuityResult: "PASS", insulationResult: "PASS", leakageCurrentResult: "PASS",
      polarityResult: "PASS", rcdTripTimeResult: "NOT_APPLICABLE", functionalTestResult: "PASS",
      failureAction: "NONE", earthContinuityReading: 0.12,
    } as never);
    expect(m.testDate).toBeInstanceOf(Date);
    expect(m.testDate.getTime()).toBe(1_700_000_000_000);
    expect(m.earthContinuityReading).toBe(0.12);
    expect(m.insulationReading).toBeNull();
    expect(m.nextDueDate).toBeNull();
  });

  it("mapSubTest normalises readings and keeps sortOrder", () => {
    const m = mapSubTest({
      id: "s", testTagRecordId: "r", label: "Outlet 1", sortOrder: 2, result: "FAIL",
      earthContinuityResult: "FAIL", insulationResult: "PASS", leakageCurrentResult: "PASS",
      polarityResult: "PASS", earthContinuityReading: 2.5,
    } as never);
    expect(m.sortOrder).toBe(2);
    expect(m.earthContinuityReading).toBe(2.5);
    expect(m.insulationReading).toBeNull();
    expect(m.notes).toBeNull();
  });

  it("mapTestProfile passes JSON through, converts dates, coerces required scalars", () => {
    const m = mapTestProfile({
      id: "p", organizationId: "o", name: "Class I",
      equipmentClass: "CLASS_I", applianceType: "APPLIANCE",
      visualChecks: [{ key: "cord", enabled: true }],
      electricalTests: [{ key: "earth" }],
      thresholds: { earthMax: 1 },
      requiresSubTests: true, defaultSubTestCount: 4, subTestLabel: "Outlet",
      createdAt: 1_700_000_000_000,
      // isDefault / isActive / updatedAt absent
    } as never);
    expect(m.requiresSubTests).toBe(true);
    expect(m.defaultSubTestCount).toBe(4);
    expect(m.subTestLabel).toBe("Outlet");
    expect(m.isDefault).toBe(false);
    expect(m.isActive).toBe(true);
    expect(m.createdAt).toBeInstanceOf(Date);
    expect(m.updatedAt).toBeNull();
    expect(m.visualChecks).toEqual([{ key: "cord", enabled: true }]);
    expect(m.thresholds).toEqual({ earthMax: 1 });
  });
});

// ─── listAssetMatchesFilters (paginated registry list) ────────────────────────

describe("listAssetMatchesFilters", () => {
  it("isActive is a PARAMETER (not hardcoded true) — both directions", () => {
    expect(listAssetMatchesFilters(asset({ isActive: true }), { isActive: true })).toBe(true);
    expect(listAssetMatchesFilters(asset({ isActive: false }), { isActive: true })).toBe(false);
    // listing retired/inactive items
    expect(listAssetMatchesFilters(asset({ isActive: false }), { isActive: false })).toBe(true);
    expect(listAssetMatchesFilters(asset({ isActive: true }), { isActive: false })).toBe(false);
  });

  it("status / equipmentClass / applianceType are EXACT single matches", () => {
    expect(listAssetMatchesFilters(asset({ status: "OVERDUE" }), { isActive: true, status: "OVERDUE" })).toBe(true);
    expect(listAssetMatchesFilters(asset({ status: "CURRENT" }), { isActive: true, status: "OVERDUE" })).toBe(false);
    expect(listAssetMatchesFilters(asset({ equipmentClass: "CLASS_II" }), { isActive: true, equipmentClass: "CLASS_II" })).toBe(true);
    expect(listAssetMatchesFilters(asset({ equipmentClass: "CLASS_I" }), { isActive: true, equipmentClass: "CLASS_II" })).toBe(false);
    expect(listAssetMatchesFilters(asset({ applianceType: "POWER_BOARD" }), { isActive: true, applianceType: "POWER_BOARD" })).toBe(true);
    expect(listAssetMatchesFilters(asset({ applianceType: "APPLIANCE" }), { isActive: true, applianceType: "POWER_BOARD" })).toBe(false);
  });

  it("assetLinkType serialized/bulk/standalone semantics", () => {
    expect(listAssetMatchesFilters(asset({ assetId: "a1" }), { isActive: true, assetLinkType: "serialized" })).toBe(true);
    expect(listAssetMatchesFilters(asset({ assetId: null }), { isActive: true, assetLinkType: "serialized" })).toBe(false);
    expect(listAssetMatchesFilters(asset({ bulkAssetId: "b1", assetId: null }), { isActive: true, assetLinkType: "bulk" })).toBe(true);
    expect(listAssetMatchesFilters(asset({ bulkAssetId: "b1", assetId: "a1" }), { isActive: true, assetLinkType: "bulk" })).toBe(false);
    expect(listAssetMatchesFilters(asset({ assetId: null, bulkAssetId: null }), { isActive: true, assetLinkType: "standalone" })).toBe(true);
    expect(listAssetMatchesFilters(asset({ assetId: "a1" }), { isActive: true, assetLinkType: "standalone" })).toBe(false);
    // "all" (or undefined) applies no link filter
    expect(listAssetMatchesFilters(asset({ assetId: "a1" }), { isActive: true, assetLinkType: "all" })).toBe(true);
  });

  it("search is case-insensitive OR over testTagId/description/serialNumber/make/modelName", () => {
    expect(listAssetMatchesFilters(asset({ description: "Powered Speaker" }), { isActive: true, search: "speaker" })).toBe(true);
    expect(listAssetMatchesFilters(asset({ serialNumber: "ABC123" }), { isActive: true, search: "abc1" })).toBe(true);
    expect(listAssetMatchesFilters(asset({ make: "Yamaha" }), { isActive: true, search: "yam" })).toBe(true);
    expect(listAssetMatchesFilters(
      asset({ make: null, modelName: null, serialNumber: null, description: "x", testTagId: "y" }),
      { isActive: true, search: "zzz" },
    )).toBe(false);
  });

  it("combines filters with AND", () => {
    const item = asset({ status: "CURRENT", assetId: "a1", make: "Yamaha", isActive: true });
    expect(listAssetMatchesFilters(item, { isActive: true, status: "CURRENT", assetLinkType: "serialized", search: "yam" })).toBe(true);
    expect(listAssetMatchesFilters(item, { isActive: true, status: "OVERDUE" })).toBe(false);
  });
});

// ─── compareTestTagAssets (null-aware + enum-declared-order sort) ──────────────

function sortBy(items: TTAsset[], key: string, order: "asc" | "desc"): string[] {
  return [...items].sort((a, b) => compareTestTagAssets(a, b, key, order)).map((i) => i.testTagId);
}

describe("compareTestTagAssets", () => {
  it("defaults to testTagId asc and falls back to it for unknown sort keys", () => {
    const items = [asset({ testTagId: "TT-003" }), asset({ testTagId: "TT-001" }), asset({ testTagId: "TT-002" })];
    expect(sortBy(items, "testTagId", "asc")).toEqual(["TT-001", "TT-002", "TT-003"]);
    // unknown key → falls back to testTagId, honouring the requested direction
    expect(sortBy(items, "bogusColumn", "asc")).toEqual(["TT-001", "TT-002", "TT-003"]);
    expect(sortBy(items, "bogusColumn", "desc")).toEqual(["TT-003", "TT-002", "TT-001"]);
  });

  it("string column desc reverses order", () => {
    const items = [asset({ testTagId: "A", description: "alpha" }), asset({ testTagId: "B", description: "zeta" })];
    expect(sortBy(items, "description", "asc")).toEqual(["A", "B"]);
    expect(sortBy(items, "description", "desc")).toEqual(["B", "A"]);
  });

  it("nullable column: ASC = NULLS LAST", () => {
    const items = [
      asset({ testTagId: "HAS", make: "Acme" }),
      asset({ testTagId: "NULL", make: null }),
      asset({ testTagId: "ZZZ", make: "Zen" }),
    ];
    expect(sortBy(items, "make", "asc")).toEqual(["HAS", "ZZZ", "NULL"]);
  });

  it("nullable column: DESC = NULLS FIRST", () => {
    const items = [
      asset({ testTagId: "HAS", make: "Acme" }),
      asset({ testTagId: "NULL", make: null }),
      asset({ testTagId: "ZZZ", make: "Zen" }),
    ];
    expect(sortBy(items, "make", "desc")).toEqual(["NULL", "ZZZ", "HAS"]);
  });

  it("nullable date column honours NULLS LAST/FIRST", () => {
    const items = [
      asset({ testTagId: "EARLY", nextDueDate: new Date("2026-01-01") }),
      asset({ testTagId: "NONE", nextDueDate: null }),
      asset({ testTagId: "LATE", nextDueDate: new Date("2027-01-01") }),
    ];
    expect(sortBy(items, "nextDueDate", "asc")).toEqual(["EARLY", "LATE", "NONE"]);
    expect(sortBy(items, "nextDueDate", "desc")).toEqual(["NONE", "LATE", "EARLY"]);
  });

  it("enum status sorts by DECLARED order (not alphabetical) asc", () => {
    // declared: NOT_YET_TESTED, CURRENT, DUE_SOON, OVERDUE, FAILED, RETIRED
    const items = [
      asset({ testTagId: "f", status: "FAILED" }),
      asset({ testTagId: "n", status: "NOT_YET_TESTED" }),
      asset({ testTagId: "o", status: "OVERDUE" }),
      asset({ testTagId: "c", status: "CURRENT" }),
    ];
    expect(sortBy(items, "status", "asc")).toEqual(["n", "c", "o", "f"]);
    expect(sortBy(items, "status", "desc")).toEqual(["f", "o", "c", "n"]);
  });

  it("enum applianceType sorts by DECLARED order", () => {
    // declared: APPLIANCE(0), CORD_SET(1), ..., MICROWAVE(7), OTHER(8)
    const items = [
      asset({ testTagId: "other", applianceType: "OTHER" }),
      asset({ testTagId: "app", applianceType: "APPLIANCE" }),
      asset({ testTagId: "micro", applianceType: "MICROWAVE" }),
    ];
    expect(sortBy(items, "applianceType", "asc")).toEqual(["app", "micro", "other"]);
  });

  it("numeric column sorts numerically", () => {
    const items = [
      asset({ testTagId: "a", testIntervalMonths: 12 }),
      asset({ testTagId: "b", testIntervalMonths: 3 }),
      asset({ testTagId: "c", testIntervalMonths: 6 }),
    ];
    expect(sortBy(items, "testIntervalMonths", "asc")).toEqual(["b", "c", "a"]);
  });

  it("ties on the sort key break deterministically on testTagId asc", () => {
    const items = [
      asset({ testTagId: "TT-002", status: "CURRENT" }),
      asset({ testTagId: "TT-001", status: "CURRENT" }),
    ];
    expect(sortBy(items, "status", "asc")).toEqual(["TT-001", "TT-002"]);
    // even when sorting desc on the enum, the tiebreak stays testTagId asc
    expect(sortBy(items, "status", "desc")).toEqual(["TT-001", "TT-002"]);
  });
});
