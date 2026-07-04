import { describe, it, expect } from "vitest";
import {
  bulkUnpackedRemaining,
  bulkPackedWaiting,
  type LineItem,
} from "./warehouse-types";

type Unit = NonNullable<LineItem["units"]>[number];

function unit(partial: Partial<Unit>): Unit {
  return {
    id: partial.id ?? "u",
    ordinal: partial.ordinal ?? 1,
    assetId: partial.assetId ?? null,
    bulkAssetId: partial.bulkAssetId ?? null,
    quantity: partial.quantity ?? 1,
    status: partial.status ?? "CONFIRMED",
    prepStatus: partial.prepStatus ?? null,
    asset: partial.asset ?? null,
    bulkAsset: partial.bulkAsset ?? null,
  };
}

function line(quantity: number, units: Unit[]): LineItem {
  return {
    id: "line",
    type: "EQUIPMENT",
    status: "CONFIRMED",
    quantity,
    checkedOutQuantity: 0,
    returnedQuantity: 0,
    description: null,
    modelId: "m",
    assetId: null,
    bulkAssetId: null,
    kitId: null,
    isKitChild: false,
    parentLineItemId: null,
    model: null,
    asset: null,
    bulkAsset: null,
    kit: null,
    units,
    prepStatus: null,
    prepContainer: null,
    isContainerLineItem: false,
    isCustomItem: false,
    subHireId: null,
    supplier: null,
  };
}

describe("bulk stage counts", () => {
  it("a fresh untagged bulk line is fully unpacked, nothing waiting", () => {
    const l = line(10, []);
    expect(bulkUnpackedRemaining(l)).toBe(10);
    expect(bulkPackedWaiting(l)).toBe(0);
  });

  it("prepping 1 of 10 leaves 9 to pick and 1 waiting to deploy", () => {
    // The reported bug: this used to move all 10 to Prepped.
    const l = line(10, [unit({ prepStatus: "PACKED" })]);
    expect(bulkUnpackedRemaining(l)).toBe(9);
    expect(bulkPackedWaiting(l)).toBe(1);
  });

  it("prepping 3 of 10 leaves 7 to pick and 3 waiting", () => {
    const units = [1, 2, 3].map((o) =>
      unit({ id: `u${o}`, ordinal: o, prepStatus: "PACKED" }),
    );
    const l = line(10, units);
    expect(bulkUnpackedRemaining(l)).toBe(7);
    expect(bulkPackedWaiting(l)).toBe(3);
  });

  it("fully prepped line has 0 to pick and all waiting", () => {
    const units = Array.from({ length: 4 }, (_, i) =>
      unit({ id: `u${i}`, ordinal: i + 1, prepStatus: "PACKED" }),
    );
    const l = line(4, units);
    expect(bulkUnpackedRemaining(l)).toBe(0);
    expect(bulkPackedWaiting(l)).toBe(4);
  });

  it("deployed units are neither unpacked nor waiting", () => {
    // 5 ordered: 2 deployed (still hold their ordered slot), 3 packed-waiting.
    const l = line(5, [
      unit({ id: "a", ordinal: 1, status: "CHECKED_OUT", prepStatus: "PACKED" }),
      unit({ id: "b", ordinal: 2, status: "CHECKED_OUT", prepStatus: "PACKED" }),
      unit({ id: "c", ordinal: 3, prepStatus: "PACKED" }),
      unit({ id: "d", ordinal: 4, prepStatus: "PACKED" }),
      unit({ id: "e", ordinal: 5, prepStatus: "PACKED" }),
    ]);
    expect(bulkUnpackedRemaining(l)).toBe(0); // all 5 slots assigned
    expect(bulkPackedWaiting(l)).toBe(3); // 3 still sitting prepped
  });

  it("partial deploy still leaves unpacked units to pick", () => {
    // 10 ordered, only 3 ever prepped, 1 of those deployed.
    const l = line(10, [
      unit({ id: "a", ordinal: 1, status: "CHECKED_OUT", prepStatus: "PACKED" }),
      unit({ id: "b", ordinal: 2, prepStatus: "PACKED" }),
      unit({ id: "c", ordinal: 3, prepStatus: "PACKED" }),
    ]);
    expect(bulkUnpackedRemaining(l)).toBe(7);
    expect(bulkPackedWaiting(l)).toBe(2);
  });

  it("returned units hold their ordered slot (not re-pickable) and don't wait", () => {
    const l = line(3, [
      unit({ id: "a", ordinal: 1, status: "RETURNED", prepStatus: "PACKED" }),
      unit({ id: "b", ordinal: 2, status: "RETURNED", prepStatus: "PACKED" }),
      unit({ id: "c", ordinal: 3, status: "RETURNED", prepStatus: "PACKED" }),
    ]);
    expect(bulkUnpackedRemaining(l)).toBe(0);
    expect(bulkPackedWaiting(l)).toBe(0);
  });

  it("a tagged bulk pool (single qty-N unit) is counted by its quantity", () => {
    const l = line(10, [
      unit({ id: "pool", ordinal: 1, bulkAssetId: "b1", quantity: 4, prepStatus: "PACKED" }),
    ]);
    expect(bulkUnpackedRemaining(l)).toBe(6);
    expect(bulkPackedWaiting(l)).toBe(4);
  });
});
