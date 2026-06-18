import { describe, it, expect } from "vitest";
import {
  mapConvexModelToRow,
  filterModels,
  sortModels,
  paginateModels,
  type ConvexModel,
  type ModelRow,
} from "./models-read";

/** Minimal Convex `models` doc factory for tests. */
function convexModel(overrides: Partial<ConvexModel> = {}): ConvexModel {
  return {
    _id: "convex_id" as ConvexModel["_id"],
    _creationTime: 1_700_000_000_000,
    id: "m1",
    organizationId: "org1",
    name: "Model 1",
    assetType: "SERIALIZED",
    isActive: true,
    requiresTestAndTag: false,
    images: ["a.jpg"],
    manuals: [],
    tags: ["x"],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    ...overrides,
  } as ConvexModel;
}

function row(overrides: Partial<ModelRow> = {}): ModelRow {
  return mapConvexModelToRow(convexModel(overrides as Partial<ConvexModel>));
}

describe("mapConvexModelToRow", () => {
  it("strips Convex system fields and converts epoch-ms to Date", () => {
    const r = mapConvexModelToRow(convexModel());
    expect((r as Record<string, unknown>)._id).toBeUndefined();
    expect((r as Record<string, unknown>)._creationTime).toBeUndefined();
    expect(r.createdAt).toBeInstanceOf(Date);
    expect(r.createdAt.getTime()).toBe(1_700_000_000_000);
    expect(r.updatedAt.getTime()).toBe(1_700_000_001_000);
  });

  it("coerces Prisma-defaulted columns when absent", () => {
    const r = mapConvexModelToRow(
      convexModel({
        images: undefined,
        manuals: undefined,
        tags: undefined,
        assetType: undefined,
        requiresTestAndTag: undefined,
        isActive: undefined,
      }),
    );
    expect(r.images).toEqual([]);
    expect(r.manuals).toEqual([]);
    expect(r.tags).toEqual([]);
    expect(r.assetType).toBe("SERIALIZED");
    expect(r.requiresTestAndTag).toBe(false);
    expect(r.isActive).toBe(true);
  });

  it("preserves provided values", () => {
    const r = mapConvexModelToRow(
      convexModel({ assetType: "BULK", isActive: false, tags: ["t1", "t2"] }),
    );
    expect(r.assetType).toBe("BULK");
    expect(r.isActive).toBe(false);
    expect(r.tags).toEqual(["t1", "t2"]);
  });
});

describe("filterModels", () => {
  const models = [
    row({ id: "a", name: "Sony FX3", manufacturer: "Sony", categoryId: "cam", assetType: "SERIALIZED", isActive: true }),
    row({ id: "b", name: "Cable XLR", manufacturer: "Neutrik", categoryId: "cbl", assetType: "BULK", isActive: true }),
    row({ id: "c", name: "Old Light", manufacturer: "Arri", categoryId: "lig", assetType: "SERIALIZED", isActive: false }),
    row({ id: "d", name: "Sony A7", manufacturer: "Sony", sku: "SONY-A7", categoryId: "cam", assetType: "SERIALIZED", isActive: true }),
  ];

  it("defaults to isActive=true", () => {
    const out = filterModels(models, {});
    expect(out.map((m) => m.id)).toEqual(["a", "b", "d"]);
  });

  it("filters by isActive=false", () => {
    const out = filterModels(models, { isActive: false });
    expect(out.map((m) => m.id)).toEqual(["c"]);
  });

  it("filters by categoryId", () => {
    const out = filterModels(models, { categoryId: "cam" });
    expect(out.map((m) => m.id)).toEqual(["a", "d"]);
  });

  it("filters by assetType", () => {
    const out = filterModels(models, { assetType: "BULK" });
    expect(out.map((m) => m.id)).toEqual(["b"]);
  });

  it("case-insensitive search across name/manufacturer/modelNumber/sku", () => {
    expect(filterModels(models, { search: "sony" }).map((m) => m.id)).toEqual(["a", "d"]);
    expect(filterModels(models, { search: "NEUTRIK" }).map((m) => m.id)).toEqual(["b"]);
    expect(filterModels(models, { search: "sony-a7" }).map((m) => m.id)).toEqual(["d"]);
  });

  it("combines filters with AND semantics", () => {
    const out = filterModels(models, { categoryId: "cam", search: "a7" });
    expect(out.map((m) => m.id)).toEqual(["d"]);
  });
});

describe("sortModels", () => {
  it("sorts by name asc (default) case-insensitively", () => {
    const models = [row({ id: "1", name: "banana" }), row({ id: "2", name: "Apple" }), row({ id: "3", name: "cherry" })];
    expect(sortModels(models, "name", "asc").map((m) => m.name)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("sorts by name desc", () => {
    const models = [row({ id: "1", name: "banana" }), row({ id: "2", name: "apple" })];
    expect(sortModels(models, "name", "desc").map((m) => m.name)).toEqual(["banana", "apple"]);
  });

  it("numeric columns compare numerically with NULLS LAST asc", () => {
    const models = [
      row({ id: "1", dailyRate: 100 }),
      row({ id: "2", dailyRate: undefined }),
      row({ id: "3", dailyRate: 20 }),
    ];
    expect(sortModels(models, "dailyRate", "asc").map((m) => m.id)).toEqual(["3", "1", "2"]);
  });

  it("numeric columns put NULLS FIRST on desc", () => {
    const models = [
      row({ id: "1", dailyRate: 100 }),
      row({ id: "2", dailyRate: undefined }),
      row({ id: "3", dailyRate: 20 }),
    ];
    expect(sortModels(models, "dailyRate", "desc").map((m) => m.id)).toEqual(["2", "1", "3"]);
  });

  it("assetType sorts by declared enum order (SERIALIZED < BULK), not alphabetical", () => {
    const models = [row({ id: "1", assetType: "BULK" }), row({ id: "2", assetType: "SERIALIZED" })];
    expect(sortModels(models, "assetType", "asc").map((m) => m.id)).toEqual(["2", "1"]);
  });

  it("category sorts by resolved category name with NULLS LAST asc", () => {
    const models = [
      row({ id: "1", categoryId: "z" }),
      row({ id: "2", categoryId: undefined }),
      row({ id: "3", categoryId: "a" }),
    ];
    const names: Record<string, string> = { z: "Zoom", a: "Audio" };
    const out = sortModels(models, "category", "asc", (m) => (m.categoryId ? names[m.categoryId] ?? null : null));
    expect(out.map((m) => m.id)).toEqual(["3", "1", "2"]);
  });
});

describe("paginateModels", () => {
  const rows = [1, 2, 3, 4, 5];
  it("returns the requested 1-based page", () => {
    expect(paginateModels(rows, 1, 2)).toEqual([1, 2]);
    expect(paginateModels(rows, 2, 2)).toEqual([3, 4]);
    expect(paginateModels(rows, 3, 2)).toEqual([5]);
  });
  it("returns empty past the end", () => {
    expect(paginateModels(rows, 4, 2)).toEqual([]);
  });
});
