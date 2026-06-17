/**
 * Unit test for countSupplierAssetsAndOrders — the JS per-supplier counter that
 * replaces the Prisma `supplierOrder.groupBy({ by: ["supplierId"] })` in
 * getSupplierCounts (Phase A). Asset counts already came from Convex.
 */
import { describe, it, expect } from "vitest";
import { countSupplierAssetsAndOrders } from "@/lib/suppliers-read";

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
