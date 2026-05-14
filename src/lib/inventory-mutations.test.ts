import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  adjustBulkAvailability,
  coalesceAdjustments,
  InventoryError,
  type TxClient,
} from "./inventory-mutations";

/**
 * These are unit tests against a mocked transaction client. The real
 * concurrency-guard behavior is also covered by integration tests against
 * a Postgres test DB once W1 lands them.
 */

function makeTx(opts: {
  updateManyCount: number;
  found?: {
    availableQuantity: number;
    organizationId: string;
    assetTag: string;
  } | null;
}): TxClient {
  return {
    bulkAsset: {
      updateMany: vi.fn().mockResolvedValue({ count: opts.updateManyCount }),
      findUnique: vi.fn().mockResolvedValue(opts.found ?? null),
    },
  } as unknown as TxClient;
}

describe("coalesceAdjustments", () => {
  it("sums deltas for the same bulkAssetId", () => {
    const result = coalesceAdjustments([
      { bulkAssetId: "a", delta: -3 },
      { bulkAssetId: "b", delta: 5 },
      { bulkAssetId: "a", delta: -2 },
    ]);
    expect(result).toEqual([
      { bulkAssetId: "a", delta: -5 },
      { bulkAssetId: "b", delta: 5 },
    ]);
  });

  it("preserves zero-net adjustments rather than dropping them", () => {
    const result = coalesceAdjustments([
      { bulkAssetId: "a", delta: 3 },
      { bulkAssetId: "a", delta: -3 },
    ]);
    expect(result).toEqual([{ bulkAssetId: "a", delta: 0 }]);
  });

  it("returns empty for empty input", () => {
    expect(coalesceAdjustments([])).toEqual([]);
  });
});

describe("adjustBulkAvailability", () => {
  it("skips zero-delta adjustments without calling the DB", async () => {
    const tx = makeTx({ updateManyCount: 0 });
    await adjustBulkAvailability(tx, "org-1", [{ bulkAssetId: "a", delta: 0 }]);
    expect(tx.bulkAsset.updateMany).not.toHaveBeenCalled();
  });

  it("applies a successful decrement (negative delta)", async () => {
    const tx = makeTx({ updateManyCount: 1 });
    await adjustBulkAvailability(tx, "org-1", [{ bulkAssetId: "a", delta: -3 }]);
    expect(tx.bulkAsset.updateMany).toHaveBeenCalledWith({
      where: {
        id: "a",
        organizationId: "org-1",
        availableQuantity: { gte: 3 },
      },
      data: { availableQuantity: { increment: -3 } },
    });
  });

  it("applies a successful increment (positive delta) without a guard clause", async () => {
    const tx = makeTx({ updateManyCount: 1 });
    await adjustBulkAvailability(tx, "org-1", [{ bulkAssetId: "a", delta: 5 }]);
    expect(tx.bulkAsset.updateMany).toHaveBeenCalledWith({
      where: { id: "a", organizationId: "org-1" },
      data: { availableQuantity: { increment: 5 } },
    });
  });

  it("throws InventoryError(NOT_FOUND) when the bulk doesn't exist", async () => {
    const tx = makeTx({ updateManyCount: 0, found: null });
    await expect(
      adjustBulkAvailability(tx, "org-1", [{ bulkAssetId: "ghost", delta: -1 }]),
    ).rejects.toMatchObject({
      name: "InventoryError",
      code: "NOT_FOUND",
      bulkAssetId: "ghost",
    });
  });

  it("throws InventoryError(CROSS_ORG) when the bulk belongs to another org", async () => {
    const tx = makeTx({
      updateManyCount: 0,
      found: { availableQuantity: 10, organizationId: "org-OTHER", assetTag: "X1" },
    });
    await expect(
      adjustBulkAvailability(tx, "org-MINE", [{ bulkAssetId: "a", delta: -1 }]),
    ).rejects.toMatchObject({
      name: "InventoryError",
      code: "CROSS_ORG",
    });
  });

  it("throws InventoryError(INSUFFICIENT_STOCK) when the guard fails", async () => {
    const tx = makeTx({
      updateManyCount: 0,
      found: { availableQuantity: 2, organizationId: "org-1", assetTag: "XLR-001" },
    });
    await expect(
      adjustBulkAvailability(tx, "org-1", [{ bulkAssetId: "a", delta: -5 }]),
    ).rejects.toMatchObject({
      name: "InventoryError",
      code: "INSUFFICIENT_STOCK",
      message: expect.stringContaining("XLR-001"),
    });
  });

  it("processes multiple adjustments in order", async () => {
    const tx = makeTx({ updateManyCount: 1 });
    await adjustBulkAvailability(tx, "org-1", [
      { bulkAssetId: "a", delta: -1 },
      { bulkAssetId: "b", delta: 2 },
      { bulkAssetId: "c", delta: -3 },
    ]);
    expect(tx.bulkAsset.updateMany).toHaveBeenCalledTimes(3);
  });

  it("aborts on the first failed adjustment (caller's transaction rolls everything back)", async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue(null);
    const tx = {
      bulkAsset: { updateMany, findUnique },
    } as unknown as TxClient;

    await expect(
      adjustBulkAvailability(tx, "org-1", [
        { bulkAssetId: "ok", delta: -1 },
        { bulkAssetId: "bad", delta: -1 },
      ]),
    ).rejects.toThrow(InventoryError);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
