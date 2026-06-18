/**
 * Unit tests for the pure asset/bulk-asset read helpers in assets-read.ts (Phase A
 * read-rewiring):
 * - kit-availability + container-search predicates (sortByAssetTagAsc,
 *   filterAvailableAssetsForKit, filterAvailableBulkAssetsForKit,
 *   filterContainerAssets), and
 * - the primary list helpers (mappers + filterAssets/filterBulkAssets/
 *   sortAssets/sortBulkAssets/paginate) that replace prisma.asset.findMany /
 *   bulkAsset.findMany + count.
 *
 * Safety property: identical eligibility/order/page-slice to the Prisma queries,
 * including the defaulted-column coercions (status/isActive/availableQuantity are
 * left absent on the Convex doc but default non-null in Postgres).
 */
import { describe, it, expect } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  sortByAssetTagAsc,
  filterAvailableAssetsForKit,
  filterAvailableBulkAssetsForKit,
  filterContainerAssets,
  mapConvexAssetToPrisma,
  mapConvexBulkAssetToPrisma,
  filterAssets,
  filterBulkAssets,
  sortAssets,
  sortBulkAssets,
  paginate,
  type ConvexAsset,
  type ConvexBulkAsset,
} from "@/lib/assets-read";

function asset(p: Partial<ConvexAsset>): ConvexAsset {
  return {
    _id: "x" as ConvexAsset["_id"],
    _creationTime: 0,
    id: p.id ?? "a",
    organizationId: "org",
    modelId: p.modelId ?? "m1",
    assetTag: p.assetTag ?? "A-001",
    ...p,
  } as ConvexAsset;
}

function bulk(p: Partial<ConvexBulkAsset>): ConvexBulkAsset {
  return {
    _id: "x" as ConvexBulkAsset["_id"],
    _creationTime: 0,
    id: p.id ?? "b",
    organizationId: "org",
    modelId: p.modelId ?? "m1",
    assetTag: p.assetTag ?? "B-001",
    ...p,
  } as ConvexBulkAsset;
}

describe("sortByAssetTagAsc", () => {
  it("sorts ascending by assetTag without mutating the input", () => {
    const input = [asset({ assetTag: "C" }), asset({ assetTag: "A" }), asset({ assetTag: "B" })];
    const out = sortByAssetTagAsc(input);
    expect(out.map((a) => a.assetTag)).toEqual(["A", "B", "C"]);
    expect(input.map((a) => a.assetTag)).toEqual(["C", "A", "B"]);
  });
});

describe("filterAvailableAssetsForKit", () => {
  it("keeps active + AVAILABLE + un-kitted assets", () => {
    const rows = [
      asset({ id: "ok", status: "AVAILABLE", isActive: true, kitId: undefined }),
      asset({ id: "checked-out", status: "CHECKED_OUT", isActive: true }),
      asset({ id: "inactive", status: "AVAILABLE", isActive: false }),
      asset({ id: "in-kit", status: "AVAILABLE", isActive: true, kitId: "k1" }),
    ];
    expect(filterAvailableAssetsForKit(rows).map((a) => a.id)).toEqual(["ok"]);
  });

  it("coerces absent status/isActive to the Prisma defaults (AVAILABLE/true)", () => {
    const rows = [asset({ id: "defaulted", status: undefined, isActive: undefined, kitId: undefined })];
    expect(filterAvailableAssetsForKit(rows).map((a) => a.id)).toEqual(["defaulted"]);
  });

  it("filters to one model when modelId is passed", () => {
    const rows = [
      asset({ id: "m1a", modelId: "m1", status: "AVAILABLE", isActive: true }),
      asset({ id: "m2a", modelId: "m2", status: "AVAILABLE", isActive: true }),
    ];
    expect(filterAvailableAssetsForKit(rows, "m2").map((a) => a.id)).toEqual(["m2a"]);
  });
});

describe("filterAvailableBulkAssetsForKit", () => {
  it("keeps active + ACTIVE + quantity>0 bulk assets", () => {
    const rows = [
      bulk({ id: "ok", status: "ACTIVE", isActive: true, availableQuantity: 3 }),
      bulk({ id: "zero", status: "ACTIVE", isActive: true, availableQuantity: 0 }),
      bulk({ id: "retired", status: "RETIRED", isActive: true, availableQuantity: 5 }),
      bulk({ id: "inactive", status: "ACTIVE", isActive: false, availableQuantity: 5 }),
    ];
    expect(filterAvailableBulkAssetsForKit(rows).map((b) => b.id)).toEqual(["ok"]);
  });

  it("coerces absent status/isActive/availableQuantity defaults (ACTIVE/true/0)", () => {
    const rows = [
      bulk({ id: "defaulted-qty-absent", status: undefined, isActive: undefined, availableQuantity: undefined }),
      bulk({ id: "defaulted-status-only", status: undefined, isActive: undefined, availableQuantity: 2 }),
    ];
    // availableQuantity absent → 0 → excluded; the one with qty 2 passes.
    expect(filterAvailableBulkAssetsForKit(rows).map((b) => b.id)).toEqual(["defaulted-status-only"]);
  });
});

describe("filterContainerAssets", () => {
  const cats = new Set(["c1", "c2"]);
  const modelCat = (id: string | null | undefined) =>
    ({ m1: "c1", m2: "c9", m3: "c2" } as Record<string, string>)[id ?? ""] ?? null;
  const modelName = (id: string | null | undefined) =>
    ({ m1: "Pelican Tote", m2: "Speaker", m3: "Road Box" } as Record<string, string>)[id ?? ""] ?? null;

  it("keeps only assets whose model category is in the set (empty query)", () => {
    const rows = [
      asset({ id: "in", modelId: "m1" }),
      asset({ id: "out-cat", modelId: "m2" }),
      asset({ id: "no-model", modelId: undefined }),
    ];
    expect(filterContainerAssets(rows, cats, "", modelCat, modelName).map((a) => a.id)).toEqual(["in"]);
  });

  it("matches query against assetTag, customName, or model name (case-insensitive)", () => {
    const rows = [
      asset({ id: "by-tag", modelId: "m1", assetTag: "CASE-42", customName: undefined }),
      asset({ id: "by-name", modelId: "m1", assetTag: "X-1", customName: "Big Box" }),
      asset({ id: "by-model", modelId: "m3", assetTag: "Y-1", customName: undefined }),
      asset({ id: "no-match", modelId: "m1", assetTag: "Z-9", customName: undefined }),
    ];
    expect(filterContainerAssets(rows, cats, "case", modelCat, modelName).map((a) => a.id)).toEqual(["by-tag"]);
    expect(filterContainerAssets(rows, cats, "big box", modelCat, modelName).map((a) => a.id)).toEqual(["by-name"]);
    expect(filterContainerAssets(rows, cats, "road", modelCat, modelName).map((a) => a.id)).toEqual(["by-model"]);
  });

  it("excludes an out-of-category asset even if its text matches", () => {
    const rows = [asset({ id: "wrong-cat", modelId: "m2", assetTag: "CASE-1" })];
    expect(filterContainerAssets(rows, cats, "case", modelCat, modelName)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Primary list helpers (getAssets / getBulkAssets)
// ---------------------------------------------------------------------------
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
