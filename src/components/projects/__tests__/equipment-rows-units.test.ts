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

describe("describeRow.hasExpandableUnits", () => {
  it("is true for a loose serialised line with ≥2 tagged units", () => {
    const d = describeRow(line({ quantity: 2, units: [unit("MIC-1", 1), unit("MIC-2", 2)] }));
    expect(d.hasExpandableUnits).toBe(true);
    expect(d.hasChildren).toBe(false);
  });

  it("is false for a single tagged unit (renders inline, not expanded)", () => {
    const d = describeRow(line({ units: [unit("MIC-1")] }));
    expect(d.hasExpandableUnits).toBe(false);
    expect(taggedUnitCount(line({ units: [unit("MIC-1")] }))).toBe(1);
  });

  it("is false for units without a resolved tag (generic/quantity deploy)", () => {
    const d = describeRow(line({ quantity: 2, units: [unit(null, 1), unit(null, 2)] }));
    expect(d.hasExpandableUnits).toBe(false);
  });

  it("does not fire for kit children or kit parents (those use childLineItems)", () => {
    expect(describeRow(line({ isKitChild: true, units: [unit("MIC-1", 1), unit("MIC-2", 2)] })).hasExpandableUnits).toBe(false);
    const kitParent = line({
      kitId: "k1",
      childLineItems: [line({ id: "c1", isKitChild: true }), line({ id: "c2", isKitChild: true })],
      units: [unit("MIC-1", 1), unit("MIC-2", 2)],
    });
    expect(describeRow(kitParent).hasExpandableUnits).toBe(false);
    expect(describeRow(kitParent).hasChildren).toBe(true);
  });
});

describe("unitFulfillmentBadge", () => {
  it("maps deploy/return lifecycle to labels", () => {
    expect(unitFulfillmentBadge("CHECKED_OUT").label).toBe("Deployed");
    expect(unitFulfillmentBadge("PREPPED").label).toBe("Prepped");
    expect(unitFulfillmentBadge("CONFIRMED").label).toBe("Assigned");
    expect(unitFulfillmentBadge("RETURNED").label).toBe("Returned");
    expect(unitFulfillmentBadge("RETURNED").status).toBe("ok");
  });

  it("distinguishes damaged/missing returns", () => {
    expect(unitFulfillmentBadge("RETURNED", "DAMAGED")).toMatchObject({ label: "Returned · Damaged", status: "warn" });
    expect(unitFulfillmentBadge("RETURNED", "MISSING")).toMatchObject({ label: "Returned · Missing", status: "overbooked" });
  });

  it("Deployed reads red via className override, not a color-only status", () => {
    const b = unitFulfillmentBadge("CHECKED_OUT");
    expect(b.className).toContain("text-t-out");
  });
});
