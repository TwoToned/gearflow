import { describe, it, expect } from "vitest";
import {
  describeRow,
  taggedUnitCount,
  unitFulfillmentBadge,
} from "../equipment-row-descriptors";
import type { LineItemData } from "../equipment-rows";

/**
 * Pure-logic coverage for the per-unit fulfillment display (Phase 1b): which
 * lines expand into per-unit rows, and how a unit status maps to its badge.
 */

const line = (p: Partial<LineItemData>): LineItemData =>
  ({ id: "li", description: "SM57", quantity: 1, unitPrice: 0, lineTotal: 0, ...p }) as LineItemData;

const unit = (assetTag: string | null, ordinal = 1) => ({
  id: `u${ordinal}`,
  ordinal,
  status: "CHECKED_OUT",
  asset: assetTag ? { id: `a${ordinal}`, assetTag } : null,
});

describe("taggedUnitCount / describeRow.hasChildren", () => {
  it("counts only units with a resolved asset/bulk tag", () => {
    expect(taggedUnitCount(line({ quantity: 2, units: [unit("MIC-1", 1), unit("MIC-2", 2)] }))).toBe(2);
    expect(taggedUnitCount(line({ units: [unit("MIC-1")] }))).toBe(1);
    expect(taggedUnitCount(line({ quantity: 2, units: [unit(null, 1), unit(null, 2)] }))).toBe(0);
  });

  it("a loose multi-unit line has no childLineItems, so it is not a parent", () => {
    expect(describeRow(line({ quantity: 2, units: [unit("MIC-1", 1), unit("MIC-2", 2)] })).hasChildren).toBe(false);
  });

  it("a kit parent has children (kit members use childLineItems)", () => {
    const kitParent = line({
      kitId: "k1",
      childLineItems: [line({ id: "c1", isKitChild: true }), line({ id: "c2", isKitChild: true })],
      units: [unit("MIC-1", 1), unit("MIC-2", 2)],
    });
    expect(describeRow(kitParent).hasChildren).toBe(true);
  });
});
