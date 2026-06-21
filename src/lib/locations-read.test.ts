/**
 * Unit tests for the pure location read-rewiring helpers (Phase A).
 *
 * These replace the Prisma `getLocations` list read in server/locations.ts. The
 * safety property: identical filter/sort/paginate semantics + relation counts +
 * parent-name shape to the Prisma query — including Postgres NULLS ordering for
 * the parent-name sort and the `isDefault desc` primary sort key.
 */
import { describe, it, expect } from "vitest";
import {
  mapLocation,
  buildLocationCounts,
  filterLocations,
  sortLocations,
  type MappedLocation,
} from "@/lib/locations-read";
import type { Doc } from "../../convex/_generated/dataModel";

type LocDoc = Doc<"locations">;

function doc(over: Partial<LocDoc>): LocDoc {
  return {
    _id: "x" as LocDoc["_id"],
    _creationTime: 1,
    id: "l1",
    organizationId: "org1",
    name: "Loc",
    ...over,
  } as LocDoc;
}

describe("mapLocation", () => {
  it("converts epoch-ms → Date, coerces defaults, strips _id/_creationTime", () => {
    const m = mapLocation(doc({ id: "l1", name: "Main", createdAt: 10, updatedAt: 20 }));
    expect(m).toEqual<MappedLocation>({
      id: "l1",
      organizationId: "org1",
      name: "Main",
      address: null,
      latitude: null,
      longitude: null,
      type: "WAREHOUSE",
      isDefault: false,
      parentId: null,
      notes: null,
      tags: [],
      createdAt: new Date(10),
      updatedAt: new Date(20),
    });
    expect((m as unknown as Record<string, unknown>)._id).toBeUndefined();
  });

  it("preserves provided fields", () => {
    const m = mapLocation(
      doc({ address: "1 St", latitude: -33, longitude: 151, type: "VEHICLE", isDefault: true, parentId: "p", notes: "n", tags: ["t"] }),
    );
    expect(m).toMatchObject({ address: "1 St", latitude: -33, longitude: 151, type: "VEHICLE", isDefault: true, parentId: "p", notes: "n", tags: ["t"] });
  });
});

const loc = (over: Partial<MappedLocation>): MappedLocation => ({
  id: "l",
  organizationId: "org1",
  name: "n",
  address: null,
  latitude: null,
  longitude: null,
  type: "WAREHOUSE",
  isDefault: false,
  parentId: null,
  notes: null,
  tags: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

describe("buildLocationCounts", () => {
  it("counts assets/bulk/kits/projects per locationId and children per parentId", () => {
    const locations = [
      { id: "root", parentId: null },
      { id: "child", parentId: "root" },
    ];
    const counts = buildLocationCounts(
      locations,
      [{ locationId: "root" }, { locationId: "root" }, { locationId: null }],
      [{ locationId: "child" }],
      [{ locationId: "root" }],
      [{ locationId: "root" }, { locationId: "child" }],
    );
    expect(counts.get("root")).toEqual({ assets: 2, bulkAssets: 0, kits: 1, children: 1, projects: 1 });
    expect(counts.get("child")).toEqual({ assets: 0, bulkAssets: 1, kits: 0, children: 0, projects: 1 });
  });
});

describe("filterLocations", () => {
  const rows = [
    loc({ id: "a", name: "Sydney Depot", address: "1 George St", type: "WAREHOUSE" }),
    loc({ id: "b", name: "Truck 1", address: null, type: "VEHICLE" }),
    loc({ id: "c", name: "Melbourne", address: "Bourke St", type: "WAREHOUSE" }),
  ];

  it("filters by exact type", () => {
    expect(filterLocations(rows, { type: "VEHICLE" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("filters by typeIn (enum in)", () => {
    expect(filterLocations(rows, { typeIn: ["VEHICLE", "WAREHOUSE"] }).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(filterLocations(rows, { typeIn: [] }).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("case-insensitive search across name OR address", () => {
    expect(filterLocations(rows, { search: "george" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterLocations(rows, { search: "truck" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterLocations(rows, { search: "zzz" })).toEqual([]);
  });
});

describe("sortLocations", () => {
  it("default sort: isDefault desc then the chosen column asc", () => {
    const rows = [
      loc({ id: "a", name: "Alpha", isDefault: false }),
      loc({ id: "b", name: "Bravo", isDefault: true }),
      loc({ id: "c", name: "Charlie", isDefault: false }),
    ];
    expect(sortLocations(rows, "name", "asc", new Map()).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("default sort respects desc direction within the column", () => {
    const rows = [loc({ id: "a", name: "Alpha" }), loc({ id: "c", name: "Charlie" })];
    expect(sortLocations(rows, "name", "desc", new Map()).map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("parent sort: NULLS LAST for asc", () => {
    const rows = [
      loc({ id: "noparent", parentId: null }),
      loc({ id: "underZ", parentId: "z" }),
      loc({ id: "underA", parentId: "a" }),
    ];
    const parentName = new Map<string, string | null>([
      ["noparent", null],
      ["underZ", "Zone"],
      ["underA", "Acme"],
    ]);
    expect(sortLocations(rows, "parent", "asc", parentName).map((r) => r.id)).toEqual([
      "underA",
      "underZ",
      "noparent",
    ]);
  });

  it("parent sort: NULLS FIRST for desc", () => {
    const rows = [
      loc({ id: "noparent", parentId: null }),
      loc({ id: "underZ", parentId: "z" }),
      loc({ id: "underA", parentId: "a" }),
    ];
    const parentName = new Map<string, string | null>([
      ["noparent", null],
      ["underZ", "Zone"],
      ["underA", "Acme"],
    ]);
    expect(sortLocations(rows, "parent", "desc", parentName).map((r) => r.id)).toEqual([
      "noparent",
      "underZ",
      "underA",
    ]);
  });

  it("sorts by a Date column", () => {
    const rows = [
      loc({ id: "old", createdAt: new Date(1000) }),
      loc({ id: "new", createdAt: new Date(3000) }),
    ];
    expect(sortLocations(rows, "createdAt", "desc", new Map()).map((r) => r.id)).toEqual(["new", "old"]);
  });
});
