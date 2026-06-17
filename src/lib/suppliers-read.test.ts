/**
 * Unit tests for the pure supplier read helpers in suppliers-read.ts (Phase A):
 * - `countSupplierAssetsAndOrders` — the JS per-supplier counter replacing the
 *   Prisma `supplierOrder.groupBy({ by: ["supplierId"] })` in getSupplierCounts.
 * - `mapSupplier` / `supplierMatchesSearch` / `compareSuppliers` — the mapper +
 *   pure filter/sort predicates backing getSuppliers / getSupplierById.
 */
import { describe, it, expect } from "vitest";
import {
  countSupplierAssetsAndOrders,
  mapSupplier,
  supplierMatchesSearch,
  compareSuppliers,
  type ConvexSupplier,
  type MappedSupplier,
} from "@/lib/suppliers-read";

describe("countSupplierAssetsAndOrders", () => {
  it("counts assets + orders per supplier", () => {
    const assets = [{ supplierId: "s1" }, { supplierId: "s1" }, { supplierId: "s2" }];
    const orders = [{ supplierId: "s1" }, { supplierId: "s3" }];
    expect(countSupplierAssetsAndOrders(assets, orders)).toEqual({
      s1: { assets: 2, orders: 1 },
      s2: { assets: 1, orders: 0 },
      s3: { assets: 0, orders: 1 },
    });
  });

  it("skips null supplierIds on both sides", () => {
    expect(
      countSupplierAssetsAndOrders([{ supplierId: null }, { supplierId: "s1" }], [{ supplierId: null }]),
    ).toEqual({ s1: { assets: 1, orders: 0 } });
  });

  it("returns an empty record for empty inputs", () => {
    expect(countSupplierAssetsAndOrders([], [])).toEqual({});
  });
});

/** Build a raw Convex supplier doc with sensible defaults; override per-test. */
function doc(over: Partial<ConvexSupplier> = {}): ConvexSupplier {
  return {
    _id: "convex_id" as ConvexSupplier["_id"],
    _creationTime: 123,
    id: "sup_1",
    organizationId: "org_1",
    name: "Acme",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    ...over,
  } as ConvexSupplier;
}

function mapped(over: Partial<ConvexSupplier> = {}): MappedSupplier {
  return mapSupplier(doc(over));
}

describe("mapSupplier", () => {
  it("converts epoch-ms createdAt/updatedAt to Date", () => {
    const m = mapSupplier(doc({ createdAt: 1_700_000_000_000, updatedAt: 1_700_000_500_000 }));
    expect(m.createdAt).toBeInstanceOf(Date);
    expect(m.createdAt.getTime()).toBe(1_700_000_000_000);
    expect(m.updatedAt.getTime()).toBe(1_700_000_500_000);
  });

  it("coerces missing timestamps to epoch 0 Dates", () => {
    const m = mapSupplier(doc({ createdAt: undefined, updatedAt: undefined }));
    expect(m.createdAt.getTime()).toBe(0);
    expect(m.updatedAt.getTime()).toBe(0);
  });

  it("coerces absent optional strings to null", () => {
    const m = mapSupplier(doc());
    expect(m.contactName).toBeNull();
    expect(m.email).toBeNull();
    expect(m.phone).toBeNull();
    expect(m.website).toBeNull();
    expect(m.address).toBeNull();
    expect(m.notes).toBeNull();
    expect(m.accountNumber).toBeNull();
    expect(m.paymentTerms).toBeNull();
    expect(m.defaultLeadTime).toBeNull();
    expect(m.latitude).toBeNull();
    expect(m.longitude).toBeNull();
  });

  it("coerces Prisma-defaulted columns: tags -> [], isActive -> true", () => {
    const m = mapSupplier(doc({ tags: undefined, isActive: undefined }));
    expect(m.tags).toEqual([]);
    expect(m.isActive).toBe(true);
  });

  it("preserves provided values including isActive: false", () => {
    const m = mapSupplier(
      doc({
        contactName: "Jane",
        email: "j@acme.test",
        tags: ["lighting", "rigging"],
        isActive: false,
        latitude: -33.8,
        longitude: 151.2,
      }),
    );
    expect(m.contactName).toBe("Jane");
    expect(m.email).toBe("j@acme.test");
    expect(m.tags).toEqual(["lighting", "rigging"]);
    expect(m.isActive).toBe(false);
    expect(m.latitude).toBe(-33.8);
    expect(m.longitude).toBe(151.2);
  });

  it("strips Convex system fields", () => {
    const m = mapSupplier(doc()) as unknown as Record<string, unknown>;
    expect(m._id).toBeUndefined();
    expect(m._creationTime).toBeUndefined();
  });
});

describe("supplierMatchesSearch", () => {
  const s = mapped({
    name: "Acme Lighting",
    contactName: "Jane Doe",
    email: "jane@acme.test",
    accountNumber: "ACC-9001",
    tags: ["lighting", "rigging"],
  });

  it("matches everything when search is blank", () => {
    expect(supplierMatchesSearch(s, "")).toBe(true);
    expect(supplierMatchesSearch(s, "   ")).toBe(true);
  });

  it("matches name case-insensitively (substring)", () => {
    expect(supplierMatchesSearch(s, "acme")).toBe(true);
    expect(supplierMatchesSearch(s, "LIGHT")).toBe(true);
  });

  it("matches contactName, email, accountNumber", () => {
    expect(supplierMatchesSearch(s, "jane")).toBe(true);
    expect(supplierMatchesSearch(s, "@acme.test")).toBe(true);
    expect(supplierMatchesSearch(s, "acc-9001")).toBe(true);
  });

  it("matches a tag exactly (lowercased), like Prisma hasSome [search.toLowerCase()]", () => {
    expect(supplierMatchesSearch(s, "rigging")).toBe(true);
    expect(supplierMatchesSearch(s, "RIGGING")).toBe(true);
    // hasSome is exact membership, not substring — partial tag should not match via the tag arm
    expect(supplierMatchesSearch(mapped({ name: "X", tags: ["rigging"] }), "rig")).toBe(false);
  });

  it("returns false when nothing matches", () => {
    expect(supplierMatchesSearch(s, "zzz-nope")).toBe(false);
  });

  it("tolerates null optional fields", () => {
    const bare = mapped({ name: "Bare", contactName: undefined, email: undefined, accountNumber: undefined, tags: [] });
    expect(supplierMatchesSearch(bare, "bare")).toBe(true);
    expect(supplierMatchesSearch(bare, "anything")).toBe(false);
  });
});

describe("compareSuppliers", () => {
  it("sorts by name ascending, case-insensitively", () => {
    const rows = [mapped({ name: "beta" }), mapped({ name: "Alpha" }), mapped({ name: "Gamma" })];
    const sorted = [...rows].sort(compareSuppliers("name", "asc")).map((r) => r.name);
    expect(sorted).toEqual(["Alpha", "beta", "Gamma"]);
  });

  it("sorts by name descending", () => {
    const rows = [mapped({ name: "Alpha" }), mapped({ name: "beta" }), mapped({ name: "Gamma" })];
    const sorted = [...rows].sort(compareSuppliers("name", "desc")).map((r) => r.name);
    expect(sorted).toEqual(["Gamma", "beta", "Alpha"]);
  });

  it("sorts by Date field (createdAt)", () => {
    const a = mapped({ name: "A", createdAt: 1_000 });
    const b = mapped({ name: "B", createdAt: 3_000 });
    const c = mapped({ name: "C", createdAt: 2_000 });
    const asc = [a, b, c].sort(compareSuppliers("createdAt", "asc")).map((r) => r.name);
    expect(asc).toEqual(["A", "C", "B"]);
    const desc = [a, b, c].sort(compareSuppliers("createdAt", "desc")).map((r) => r.name);
    expect(desc).toEqual(["B", "C", "A"]);
  });

  it("sorts by boolean field (isActive)", () => {
    const t = mapped({ name: "T", isActive: true });
    const f = mapped({ name: "F", isActive: false });
    const asc = [t, f].sort(compareSuppliers("isActive", "asc")).map((r) => r.name);
    expect(asc).toEqual(["F", "T"]);
  });

  it("sorts nulls last regardless of direction", () => {
    const withVal = mapped({ name: "Z", accountNumber: "A1" });
    const noVal = mapped({ name: "A", accountNumber: undefined });
    expect(
      [noVal, withVal].sort(compareSuppliers("accountNumber", "asc")).map((r) => r.name),
    ).toEqual(["Z", "A"]);
    expect(
      [withVal, noVal].sort(compareSuppliers("accountNumber", "desc")).map((r) => r.name),
    ).toEqual(["Z", "A"]);
  });
});
