/**
 * Unit tests for the pure test-profile read helpers (mapper + filter/sort).
 *
 * These replace the Prisma reads `getTestProfiles` (findMany where org + optional
 * isActive/equipmentClass/applianceType, orderBy name asc) and `getTestProfile`
 * (findFirst { id, organizationId }). The safety property: the mapped Convex doc
 * matches the Prisma row shape (epoch-ms → Date, absent → null, defaults coerced,
 * Json passed through) and the JS filter/sort reproduces the Prisma where/orderBy.
 */
import { describe, it, expect } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  mapTestProfile,
  filterAndSortTestProfiles,
  type TestProfileRow,
} from "@/lib/test-profiles-read";

type RawProfile = Doc<"testProfiles">;

function rawProfile(over: Partial<RawProfile> = {}): RawProfile {
  return {
    _id: "doc_1" as RawProfile["_id"],
    _creationTime: 123,
    id: "tp1",
    organizationId: "org1",
    name: "Class I Appliance",
    equipmentClass: "CLASS_I",
    applianceType: "APPLIANCE",
    visualChecks: [{ key: "casing", label: "Casing", enabled: true }],
    electricalTests: [{ key: "earth", threshold: 1 }],
    thresholds: { earthMax: 1, insulationMin: 1 },
    requiresSubTests: false,
    defaultSubTestCount: 1,
    subTestLabel: "Outlet",
    isDefault: false,
    isActive: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    ...over,
  };
}

describe("mapTestProfile", () => {
  it("maps epoch-ms to Date and passes Json fields through unchanged", () => {
    const visualChecks = [{ key: "casing", label: "Casing", enabled: true }];
    const electricalTests = [{ key: "earth", threshold: 1 }];
    const thresholds = { earthMax: 1, insulationMin: 1 };
    const row = mapTestProfile(
      rawProfile({ visualChecks, electricalTests, thresholds }),
    );

    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.createdAt?.getTime()).toBe(1_700_000_000_000);
    expect(row.updatedAt?.getTime()).toBe(1_700_000_500_000);
    // Json fields pass through by reference, untouched.
    expect(row.visualChecks).toBe(visualChecks);
    expect(row.electricalTests).toBe(electricalTests);
    expect(row.thresholds).toBe(thresholds);
  });

  it("strips _id/_creationTime and keeps no Convex internals", () => {
    const row = mapTestProfile(rawProfile()) as unknown as Record<string, unknown>;
    expect(row._id).toBeUndefined();
    expect(row._creationTime).toBeUndefined();
  });

  it("coerces absent Prisma-defaulted columns to their defaults", () => {
    const row = mapTestProfile(
      rawProfile({
        equipmentClass: undefined,
        applianceType: undefined,
        requiresSubTests: undefined,
        defaultSubTestCount: undefined,
        subTestLabel: undefined,
        isDefault: undefined,
        isActive: undefined,
      }),
    );
    expect(row.equipmentClass).toBe("CLASS_I");
    expect(row.applianceType).toBe("APPLIANCE");
    expect(row.requiresSubTests).toBe(false);
    expect(row.defaultSubTestCount).toBe(1);
    expect(row.subTestLabel).toBe("Outlet");
    expect(row.isDefault).toBe(false);
    expect(row.isActive).toBe(true);
  });

  it("maps absent createdAt/updatedAt to null", () => {
    const row = mapTestProfile(
      rawProfile({ createdAt: undefined, updatedAt: undefined }),
    );
    expect(row.createdAt).toBeNull();
    expect(row.updatedAt).toBeNull();
  });

  it("preserves provided non-default values", () => {
    const row = mapTestProfile(
      rawProfile({
        equipmentClass: "CLASS_II",
        applianceType: "POWER_BOARD",
        requiresSubTests: true,
        defaultSubTestCount: 4,
        subTestLabel: "Phase",
        isDefault: true,
        isActive: false,
      }),
    );
    expect(row.equipmentClass).toBe("CLASS_II");
    expect(row.applianceType).toBe("POWER_BOARD");
    expect(row.requiresSubTests).toBe(true);
    expect(row.defaultSubTestCount).toBe(4);
    expect(row.subTestLabel).toBe("Phase");
    expect(row.isDefault).toBe(true);
    expect(row.isActive).toBe(false);
  });
});

function row(over: Partial<TestProfileRow>): TestProfileRow {
  return mapTestProfile(rawProfile(over as Partial<RawProfile>));
}

describe("filterAndSortTestProfiles", () => {
  const profiles = [
    row({ id: "b", name: "Beta", isActive: true }),
    row({ id: "a", name: "Alpha", isActive: true }),
    row({ id: "c", name: "Gamma", isActive: false }),
  ];

  it("defaults to isActive=true and sorts by name asc", () => {
    const out = filterAndSortTestProfiles(profiles);
    expect(out.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
  });

  it("returns inactive profiles when isActive=false", () => {
    const out = filterAndSortTestProfiles(profiles, { isActive: false });
    expect(out.map((p) => p.name)).toEqual(["Gamma"]);
  });

  it("filters by equipmentClass", () => {
    const list = [
      row({ id: "1", name: "One", equipmentClass: "CLASS_I" }),
      row({ id: "2", name: "Two", equipmentClass: "CLASS_II" }),
    ];
    const out = filterAndSortTestProfiles(list, { equipmentClass: "CLASS_II" });
    expect(out.map((p) => p.id)).toEqual(["2"]);
  });

  it("filters by applianceType", () => {
    const list = [
      row({ id: "1", name: "One", applianceType: "APPLIANCE" }),
      row({ id: "2", name: "Two", applianceType: "POWER_BOARD" }),
    ];
    const out = filterAndSortTestProfiles(list, { applianceType: "POWER_BOARD" });
    expect(out.map((p) => p.id)).toEqual(["2"]);
  });

  it("combines all filters (AND) and still sorts", () => {
    const list = [
      row({ id: "1", name: "Zed", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", isActive: true }),
      row({ id: "2", name: "Ann", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", isActive: true }),
      row({ id: "3", name: "Mid", equipmentClass: "CLASS_II", applianceType: "APPLIANCE", isActive: true }),
    ];
    const out = filterAndSortTestProfiles(list, {
      isActive: true,
      equipmentClass: "CLASS_I",
      applianceType: "APPLIANCE",
    });
    expect(out.map((p) => p.name)).toEqual(["Ann", "Zed"]);
  });
});
