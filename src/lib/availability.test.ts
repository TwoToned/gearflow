import { describe, expect, it } from "vitest"
import { computeStockBreakdown } from "./availability"

describe("computeStockBreakdown", () => {
  describe("SERIALIZED models", () => {
    it("counts all active assets as totalStock", () => {
      const result = computeStockBreakdown({
        assetType: "SERIALIZED",
        assets: [
          { status: "AVAILABLE" },
          { status: "CHECKED_OUT" },
          { status: "AVAILABLE" },
        ],
        bulkAssets: [],
      })
      expect(result.totalStock).toBe(3)
      expect(result.effectiveStock).toBe(3)
      expect(result.unavailable).toBe(0)
    })

    it("deducts IN_MAINTENANCE assets from effectiveStock", () => {
      const result = computeStockBreakdown({
        assetType: "SERIALIZED",
        assets: [
          { status: "AVAILABLE" },
          { status: "IN_MAINTENANCE" },
          { status: "AVAILABLE" },
        ],
        bulkAssets: [],
      })
      expect(result.totalStock).toBe(3)
      expect(result.effectiveStock).toBe(2)
      expect(result.unavailable).toBe(1)
    })

    it("deducts LOST assets from effectiveStock", () => {
      const result = computeStockBreakdown({
        assetType: "SERIALIZED",
        assets: [
          { status: "AVAILABLE" },
          { status: "LOST" },
        ],
        bulkAssets: [],
      })
      expect(result.totalStock).toBe(2)
      expect(result.effectiveStock).toBe(1)
      expect(result.unavailable).toBe(1)
    })

    it("deducts RETIRED assets from effectiveStock", () => {
      const result = computeStockBreakdown({
        assetType: "SERIALIZED",
        assets: [
          { status: "RETIRED" },
          { status: "RETIRED" },
          { status: "AVAILABLE" },
        ],
        bulkAssets: [],
      })
      expect(result.totalStock).toBe(3)
      expect(result.effectiveStock).toBe(1)
      expect(result.unavailable).toBe(2)
    })

    it("handles mix of all unavailable statuses", () => {
      const result = computeStockBreakdown({
        assetType: "SERIALIZED",
        assets: [
          { status: "AVAILABLE" },
          { status: "IN_MAINTENANCE" },
          { status: "LOST" },
          { status: "RETIRED" },
          { status: "CHECKED_OUT" },
        ],
        bulkAssets: [],
      })
      expect(result.totalStock).toBe(5)
      expect(result.effectiveStock).toBe(2)
      expect(result.unavailable).toBe(3)
    })

    it("returns zero stock for empty assets", () => {
      const result = computeStockBreakdown({
        assetType: "SERIALIZED",
        assets: [],
        bulkAssets: [],
      })
      expect(result.totalStock).toBe(0)
      expect(result.effectiveStock).toBe(0)
      expect(result.unavailable).toBe(0)
    })

    it("handles all assets unavailable", () => {
      const result = computeStockBreakdown({
        assetType: "SERIALIZED",
        assets: [
          { status: "IN_MAINTENANCE" },
          { status: "LOST" },
        ],
        bulkAssets: [],
      })
      expect(result.totalStock).toBe(2)
      expect(result.effectiveStock).toBe(0)
      expect(result.unavailable).toBe(2)
    })
  })

  describe("BULK models", () => {
    it("sums totalQuantity from bulkAssets", () => {
      const result = computeStockBreakdown({
        assetType: "BULK",
        assets: [],
        bulkAssets: [
          { totalQuantity: 10 },
          { totalQuantity: 5 },
        ],
      })
      expect(result.totalStock).toBe(15)
      expect(result.effectiveStock).toBe(15)
      expect(result.unavailable).toBe(0)
    })

    it("returns zero for empty bulkAssets", () => {
      const result = computeStockBreakdown({
        assetType: "BULK",
        assets: [],
        bulkAssets: [],
      })
      expect(result.totalStock).toBe(0)
      expect(result.effectiveStock).toBe(0)
      expect(result.unavailable).toBe(0)
    })

    it("never counts unavailable for bulk (bulk has no asset statuses)", () => {
      const result = computeStockBreakdown({
        assetType: "BULK",
        assets: [{ status: "IN_MAINTENANCE" }],
        bulkAssets: [{ totalQuantity: 20 }],
      })
      expect(result.totalStock).toBe(20)
      expect(result.effectiveStock).toBe(20)
      expect(result.unavailable).toBe(0)
    })
  })
})
