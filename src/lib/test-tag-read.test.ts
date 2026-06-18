import { describe, it, expect } from "vitest";
import {
  assetMatchesFilters,
  recordMatchesFilters,
  mapTTAsset,
  mapTTRecord,
  mapSubTest,
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
});
