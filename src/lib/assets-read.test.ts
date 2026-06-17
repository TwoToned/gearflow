/**
 * Unit tests for the pure asset/bulk-asset list helpers in assets-read.ts —
 * the Convex-backed replacements for prisma.asset.findMany / bulkAsset.findMany
 * + count (server/assets.ts:getAssets, server/bulk-assets.ts:getBulkAssets).
 *
 * Safety property: identical row set + order + page slice to the old Prisma
 * where/orderBy/skip/take. Mappers rebuild the Prisma row shape (Date,
 * Decimal, defaulted-non-null columns) from the Convex doc (epoch-ms, number,
 * absent → undefined).
 */
import { describe, it, expect } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  mapConvexAssetToPrisma,
  mapConvexBulkAssetToPrisma,
  filterAssets,
  filterBulkAssets,
  sortAssets,
  sortBulkAssets,
  paginate,
} from "@/lib/assets-read";

type AssetDoc = Doc<"assets">;
type BulkDoc = Doc<"bulkAssets">;

function assetDoc(over: Partial<AssetDoc>): AssetDoc {
  return {
    _id: "x" as AssetDoc["_id"],
    _creationTime: 0,
    id: "a1",
    organizationId: "org1",
    modelId: "m1",
    assetTag: "AST-001",
    ...over,
  } as AssetDoc;
}

function bulkDoc(over: Partial<BulkDoc>): BulkDoc {
  return {
    _id: "x" as BulkDoc["_id"],
    _creationTime: 0,
    id: "b1",
    organizationId: "org1",
    modelId: "m1",
    assetTag: "BLK-001",
    ...over,
  } as BulkDoc;
}

// model/category/location lookups injected as plain functions in the helpers.
const modelNames: Record<string, string> = { m1: "Speaker", m2: "Cable", m3: "Mixer" };
const modelCategories: Record<string, string> = { m1: "audio", m2: "audio", m3: "mixers" };
const locationNames: Record<string, string> = { l1: "Warehouse A", l2: "Warehouse B" };
const modelNameFor = (id: string) => modelNames[id];
const categoryFor = (id: string) => modelCategories[id];
const locationNameFor = (id: string | null) => (id ? locationNames[id] : null);

describe("mapConvexAssetToPrisma", () => {
  it("rebuilds the Prisma row shape, coercing defaults and converting types", () => {
    const row = mapConvexAssetToPrisma(
      assetDoc({
        purchaseDate: 1_700_000_000_000,
        purchasePrice: 199.99,
        warrantyExpiry: undefined,
        createdAt: 1_600_000_000_000,
        updatedAt: 1_600_000_001_000,
      }),
    );
    expect(row.purchaseDate).toBeInstanceOf(Date);
    expect((row.purchaseDate as Date).getTime()).toBe(1_700_000_000_000);
    expect(row.warrantyExpiry).toBeNull();
    // Decimal — duck-typed by toNumber() (serialize() turns it into a number).
    expect((row.purchasePrice as unknown as { toNumber(): number }).toNumber()).toBeCloseTo(199.99);
    // defaulted-non-null columns
    expect(row.status).toBe("AVAILABLE");
    expect(row.condition).toBe("NEW");
    expect(row.isActive).toBe(true);
    expect(row.images).toEqual([]);
    expect(row.tags).toEqual([]);
    // absent → null
    expect(row.serialNumber).toBeNull();
    expect(row.supplierId).toBeNull();
    // no Convex system fields leak through
    expect("_id" in row).toBe(false);
    expect("_creationTime" in row).toBe(false);
  });

  it("preserves explicitly-set non-default scalars", () => {
    const row = mapConvexAssetToPrisma(
      assetDoc({ status: "CHECKED_OUT", condition: "FAIR", isActive: false, tags: ["x"], serialNumber: "SN1" }),
    );
    expect(row.status).toBe("CHECKED_OUT");
    expect(row.condition).toBe("FAIR");
    expect(row.isActive).toBe(false);
    expect(row.tags).toEqual(["x"]);
    expect(row.serialNumber).toBe("SN1");
  });
});

describe("mapConvexBulkAssetToPrisma", () => {
  it("rebuilds the Prisma row shape with quantity + status defaults", () => {
    const row = mapConvexBulkAssetToPrisma(bulkDoc({ purchasePricePerUnit: 5.5 }));
    expect(row.totalQuantity).toBe(0);
    expect(row.availableQuantity).toBe(0);
    expect(row.status).toBe("ACTIVE");
    expect(row.isActive).toBe(true);
    expect((row.purchasePricePerUnit as unknown as { toNumber(): number }).toNumber()).toBeCloseTo(5.5);
    expect(row.purchasePricePerUnit).not.toBeNull();
    expect("_id" in row).toBe(false);
  });
});

describe("filterAssets", () => {
  const rows = [
    mapConvexAssetToPrisma(assetDoc({ id: "a1", modelId: "m1", assetTag: "AST-001", status: "AVAILABLE", condition: "NEW", locationId: "l1", isActive: true, tags: ["red"], serialNumber: "SN-AAA" })),
    mapConvexAssetToPrisma(assetDoc({ id: "a2", modelId: "m2", assetTag: "AST-002", status: "CHECKED_OUT", condition: "GOOD", locationId: "l2", isActive: true, tags: ["blue"] })),
    mapConvexAssetToPrisma(assetDoc({ id: "a3", modelId: "m3", assetTag: "AST-003", status: "RETIRED", condition: "POOR", isActive: false })),
  ];

  it("defaults to isActive only", () => {
    const out = filterAssets(rows, { isActive: true }, modelNameFor, categoryFor);
    expect(out.map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("filters by isActive: false", () => {
    const out = filterAssets(rows, { isActive: false }, modelNameFor, categoryFor);
    expect(out.map((r) => r.id)).toEqual(["a3"]);
  });

  it("filters by status/condition/locationId/modelId", () => {
    expect(filterAssets(rows, { isActive: true, status: "AVAILABLE" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["a1"]);
    expect(filterAssets(rows, { isActive: true, condition: "GOOD" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["a2"]);
    expect(filterAssets(rows, { isActive: true, locationId: "l1" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["a1"]);
    expect(filterAssets(rows, { isActive: true, modelId: "m2" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["a2"]);
  });

  it("filters by categoryId (via the model map)", () => {
    expect(filterAssets(rows, { isActive: true, categoryId: "audio" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("applies enum `in` filters and tags hasSome", () => {
    expect(filterAssets(rows, { isActive: true, statusIn: ["CHECKED_OUT"] }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["a2"]);
    expect(filterAssets(rows, { isActive: true, locationIdIn: ["l1", "l2"] }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(filterAssets(rows, { isActive: true, categoryIdIn: ["mixers"] }, modelNameFor, categoryFor).map((r) => r.id)).toEqual([]);
    expect(filterAssets(rows, { isActive: true, tagsHasSome: ["red"] }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["a1"]);
  });

  it("searches assetTag, serialNumber, and model.name case-insensitively", () => {
    expect(filterAssets(rows, { isActive: true, search: "ast-001" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["a1"]);
    expect(filterAssets(rows, { isActive: true, search: "sn-aaa" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["a1"]);
    expect(filterAssets(rows, { isActive: true, search: "cable" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["a2"]);
  });
});

describe("filterBulkAssets", () => {
  const rows = [
    mapConvexBulkAssetToPrisma(bulkDoc({ id: "b1", modelId: "m1", assetTag: "BLK-001", status: "ACTIVE", locationId: "l1", isActive: true })),
    mapConvexBulkAssetToPrisma(bulkDoc({ id: "b2", modelId: "m3", assetTag: "BLK-002", status: "LOW_STOCK", isActive: true })),
    mapConvexBulkAssetToPrisma(bulkDoc({ id: "b3", modelId: "m2", assetTag: "BLK-003", status: "RETIRED", isActive: false })),
  ];

  it("defaults to isActive only", () => {
    expect(filterBulkAssets(rows, { isActive: true }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["b1", "b2"]);
  });

  it("filters by status/location/model/category", () => {
    expect(filterBulkAssets(rows, { isActive: true, status: "LOW_STOCK" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["b2"]);
    expect(filterBulkAssets(rows, { isActive: true, locationId: "l1" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["b1"]);
    expect(filterBulkAssets(rows, { isActive: true, categoryId: "mixers" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["b2"]);
  });

  it("searches assetTag and model.name", () => {
    expect(filterBulkAssets(rows, { isActive: true, search: "blk-001" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["b1"]);
    expect(filterBulkAssets(rows, { isActive: true, search: "mixer" }, modelNameFor, categoryFor).map((r) => r.id)).toEqual(["b2"]);
  });
});

describe("sortAssets", () => {
  const rows = [
    mapConvexAssetToPrisma(assetDoc({ id: "a1", assetTag: "AST-003", modelId: "m3", status: "RETIRED", locationId: "l2" })),
    mapConvexAssetToPrisma(assetDoc({ id: "a2", assetTag: "AST-001", modelId: "m1", status: "AVAILABLE", locationId: undefined })),
    mapConvexAssetToPrisma(assetDoc({ id: "a3", assetTag: "AST-002", modelId: "m2", status: "CHECKED_OUT", locationId: "l1" })),
  ];

  it("sorts by scalar assetTag asc/desc", () => {
    expect(sortAssets(rows, "assetTag", "asc", modelNameFor, locationNameFor).map((r) => r.assetTag)).toEqual(["AST-001", "AST-002", "AST-003"]);
    expect(sortAssets(rows, "assetTag", "desc", modelNameFor, locationNameFor).map((r) => r.assetTag)).toEqual(["AST-003", "AST-002", "AST-001"]);
  });

  it("sorts by model.name", () => {
    expect(sortAssets(rows, "model", "asc", modelNameFor, locationNameFor).map((r) => r.id)).toEqual(["a3", "a1", "a2"]);
  });

  it("sorts enum status by DECLARED order, not alphabetical", () => {
    // declared: AVAILABLE < CHECKED_OUT < RETIRED (alpha would put AVAILABLE, CHECKED_OUT, RETIRED too — use a discriminating case)
    expect(sortAssets(rows, "status", "asc", modelNameFor, locationNameFor).map((r) => r.status)).toEqual(["AVAILABLE", "CHECKED_OUT", "RETIRED"]);
  });

  it("sorts location with NULLS LAST on asc, NULLS FIRST on desc", () => {
    expect(sortAssets(rows, "location", "asc", modelNameFor, locationNameFor).map((r) => r.id)).toEqual(["a3", "a1", "a2"]);
    expect(sortAssets(rows, "location", "desc", modelNameFor, locationNameFor).map((r) => r.id)).toEqual(["a2", "a1", "a3"]);
  });
});

describe("sortBulkAssets", () => {
  const rows = [
    mapConvexBulkAssetToPrisma(bulkDoc({ id: "b1", assetTag: "BLK-002", status: "RETIRED" })),
    mapConvexBulkAssetToPrisma(bulkDoc({ id: "b2", assetTag: "BLK-001", status: "ACTIVE" })),
  ];
  it("sorts enum status by declared order", () => {
    expect(sortBulkAssets(rows, "status", "asc", modelNameFor, locationNameFor).map((r) => r.status)).toEqual(["ACTIVE", "RETIRED"]);
  });
  it("sorts by assetTag", () => {
    expect(sortBulkAssets(rows, "assetTag", "asc", modelNameFor, locationNameFor).map((r) => r.assetTag)).toEqual(["BLK-001", "BLK-002"]);
  });
});

describe("paginate", () => {
  const rows = [1, 2, 3, 4, 5];
  it("slices 1-based page/pageSize", () => {
    expect(paginate(rows, 1, 2)).toEqual([1, 2]);
    expect(paginate(rows, 2, 2)).toEqual([3, 4]);
    expect(paginate(rows, 3, 2)).toEqual([5]);
    expect(paginate(rows, 4, 2)).toEqual([]);
  });
});
