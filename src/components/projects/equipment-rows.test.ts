/**
 * Unit tests for describeRow — the 3-axis row descriptor that replaced the
 * scattered inline `kitId && !isKitChild` style conditions in the row
 * primitive. Seeds test S14 (row primitive descriptor matrix) from the
 * cross-type unification test plan.
 *
 * Each case asserts the descriptor matches the EXACT condition the row
 * previously rendered against, so a regression in the dispatch is caught.
 */

import { describe, it, expect } from "vitest";
import { describeRow, getDisallowedDropReason, type LineItemData } from "./equipment-rows";

function item(overrides: Partial<LineItemData>): LineItemData {
  return {
    id: "li-1",
    description: "Item",
    quantity: 1,
    unitPrice: 0,
    lineTotal: 0,
    ...overrides,
  };
}

describe("describeRow", () => {
  it("plain own-stock line → owned / standalone", () => {
    const d = describeRow(item({ modelId: "m1" }));
    expect(d).toMatchObject({ source: "owned", role: "standalone", isKit: false, isSubhire: false, hasChildren: false });
  });

  it("custom item → custom source", () => {
    const d = describeRow(item({ isCustomItem: true }));
    expect(d.source).toBe("custom");
    expect(d.isSubhire).toBe(false);
  });

  it("sub-hire line (subHireId) → subhire source", () => {
    const d = describeRow(item({ subHireId: "sh1" }));
    expect(d.source).toBe("subhire");
    expect(d.isSubhire).toBe(true);
  });

  it("legacy sub-hire (type SUBHIRE, no subHireId) → subhire source", () => {
    const d = describeRow(item({ type: "SUBHIRE" }));
    expect(d.isSubhire).toBe(true);
    expect(d.source).toBe("subhire");
  });

  it("kit parent (kitId, not child, with children) → owned / parent / isKit", () => {
    const d = describeRow(
      item({ kitId: "k1", childLineItems: [item({ id: "c1", isKitChild: true })] }),
    );
    expect(d.isKit).toBe(true);
    expect(d.role).toBe("parent");
    expect(d.hasChildren).toBe(true);
    expect(d.source).toBe("owned");
  });

  it("kit child → child role, not a kit parent", () => {
    const d = describeRow(item({ kitId: "k1", isKitChild: true }));
    expect(d.role).toBe("child");
    expect(d.isKit).toBe(false);
  });

  it("sub-hire group parent (subHireId, not child, with children) → subhire / parent", () => {
    const d = describeRow(
      item({ subHireId: "sh1", childLineItems: [item({ id: "c1", isKitChild: true })] }),
    );
    expect(d.source).toBe("subhire");
    expect(d.role).toBe("parent");
    expect(d.hasChildren).toBe(true);
  });

  it("sub-hire child (isKitChild flag set) → child role, no expand chevron", () => {
    const d = describeRow(
      item({ subHireId: "sh1", isKitChild: true, childLineItems: [] }),
    );
    expect(d.role).toBe("child");
    expect(d.hasChildren).toBe(false);
    // still a sub-hire SOURCE even though it's a child (the orthogonality a
    // flat enum couldn't express)
    expect(d.isSubhire).toBe(true);
  });

  it("kitId present but zero children → not a parent (no chevron)", () => {
    const d = describeRow(item({ kitId: "k1", childLineItems: [] }));
    expect(d.hasChildren).toBe(false);
    expect(d.role).toBe("standalone");
    expect(d.isKit).toBe(true); // still badged as a kit
  });

  it("custom item never reads as sub-hire even if type is stale", () => {
    const d = describeRow(item({ isCustomItem: true, type: "EQUIPMENT" }));
    expect(d.source).toBe("custom");
  });
});

/**
 * S7 from the cross-type unification test plan — Drop Matrix 8C.
 * The predicate behind the rejection visual (red border-l + cursor
 * not-allowed) AND the toast-on-drop refusal both consume this
 * function, so locking its outputs is the cheapest way to keep the
 * disallow rules honest.
 */
describe("getDisallowedDropReason — Drop Matrix 8C", () => {
  it("rejects own-stock line item dropped onto a sub-hire group", () => {
    const reason = getDisallowedDropReason("li-abc", "shg-xyz");
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/sub-hire group/i);
  });

  it("rejects a project group dropped onto a sub-hire group", () => {
    const reason = getDisallowedDropReason("grp-pg1", "shg-sh1");
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/nested/i);
  });

  it("rejects a sub-hire group dropped onto a project group (no nested)", () => {
    const reason = getDisallowedDropReason("shg-sh1", "grp-pg1");
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/nested/i);
  });

  it("allows a sub-hire group dropped on a category (cross-category move)", () => {
    expect(getDisallowedDropReason("shg-sh1", "cat-c1")).toBeNull();
  });

  it("allows a project group dropped on a category", () => {
    expect(getDisallowedDropReason("grp-pg1", "cat-c1")).toBeNull();
  });

  it("allows a line item dropped on a project group", () => {
    expect(getDisallowedDropReason("li-abc", "grp-pg1")).toBeNull();
  });

  it("allows a line item dropped on another line item (existing reorder)", () => {
    expect(getDisallowedDropReason("li-a", "li-b")).toBeNull();
  });

  it("allows a sub-hire group dropped onto another sub-hire group (reorder candidate)", () => {
    // The reorder/move decision is made downstream by handleDragEnd —
    // the disallow predicate only flags structural impossibilities.
    expect(getDisallowedDropReason("shg-a", "shg-b")).toBeNull();
  });
});
