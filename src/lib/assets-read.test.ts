/**
 * Unit tests for the pure asset filter/sort predicates that replicate the Prisma
 * `where`/`orderBy` of the kit-availability and container-search reads now that
 * the asset rows come off Convex (Phase A read-rewiring).
 *
 * Safety property: identical eligibility + ordering to the Prisma queries,
 * including the defaulted-column coercions (status/isActive/availableQuantity are
 * left absent on the Convex doc but default non-null in Postgres).
 */
import { describe, it, expect } from "vitest";
import {
  sortByAssetTagAsc,
  filterAvailableAssetsForKit,
  filterAvailableBulkAssetsForKit,
  filterContainerAssets,
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
