import { describe, it, expect, vi } from "vitest";

import { buildBulkEquipmentActions } from "./bulk-equipment";
import { buildCategoryActions } from "./category";
import { buildGroupActions } from "./group";
import { buildSubHireActions } from "./subhire";

const fn = () => vi.fn();

describe("section row builders", () => {
  it("group: items absent without a handler, never disabled, delete last and red", () => {
    expect(buildGroupActions({ title: "G" }, {}).items).toEqual([]);
    const spec = buildGroupActions({ title: "G" }, {
      onEdit: fn(), onEditPrice: fn(), onAddEquipment: fn(), onAddKit: fn(), onSaveAsTemplate: fn(), onMoveToCategory: fn(), onRemove: fn(),
    });
    for (const i of spec.items) expect("disabled" in i).toBe(false);
    const last = spec.items[spec.items.length - 1];
    expect(last.key).toBe("delete");
    expect(last.danger).toBe(true);
  });

  it("group: the reveal entry only exists inside a rollup category and flips its label", () => {
    const ctx = { onTogglePriceReveal: fn() };
    const keys = (r: boolean, inRollup: boolean) =>
      buildGroupActions({ title: "G", revealPriceInRollup: r }, { ...ctx, inRollupCategory: inRollup }).items.map((i) => i.label);
    expect(keys(false, false)).toEqual([]);
    expect(keys(false, true)).toEqual(["Show this price"]);
    expect(keys(true, true)).toEqual(["Hide this price"]);
  });

  it("category: pricing display toggles to the OTHER mode; delete opens the surface's dialog (no inline confirm)", () => {
    const set = fn();
    const del = fn();
    const spec = buildCategoryActions({ name: "RF" }, { onSetPricingDisplay: set, onRemove: del });
    spec.items.find((i) => i.key === "pricing-display")!.onSelect();
    expect(set).toHaveBeenCalledWith("ROLLUP");
    const rolled = buildCategoryActions({ name: "RF", pricingDisplay: "ROLLUP" }, { onSetPricingDisplay: set });
    rolled.items[0].onSelect();
    expect(set).toHaveBeenLastCalledWith("ITEMISED");
    const d = spec.items.find((i) => i.key === "delete")!;
    expect(d.confirm).toBeUndefined();
    d.onSelect();
    expect(del).toHaveBeenCalled();
  });

  it("sub-hire: edit-in-order, price, move", () => {
    const keys = buildSubHireActions({ title: "S" }, { onEditInOrder: fn(), onEditPrice: fn(), onMoveToCategory: fn() }).items.map((i) => i.key);
    expect(keys).toEqual(["edit-order", "edit-price", "move-category"]);
    expect(buildSubHireActions({ title: "S" }, {}).items).toEqual([]);
  });
});

describe("buildBulkEquipmentActions", () => {
  const ctx = { onEdit: fn(), onMoveToGroup: fn(), onMoveToCategory: fn(), onExcludeFromRoi: fn(), onDelete: fn() };
  const gear = { modelId: "m" };

  it("the four live verbs, delete last and red; labels are plain", () => {
    const a = buildBulkEquipmentActions([gear], { ...ctx, onExcludeFromRoi: undefined });
    expect(a.map((x) => x.key)).toEqual(["edit", "move-group", "move-category", "delete"]);
    expect(a[a.length - 1].danger).toBe(true);
  });

  it("Exclude from ROI carries the count and only shows when some row can be excluded", () => {
    const a = buildBulkEquipmentActions([gear, { modelId: "n" }], ctx);
    expect(a.find((x) => x.key === "exclude-roi")!.label(2)).toBe("Exclude 2 from ROI");
    expect(buildBulkEquipmentActions([{ modelId: null }], ctx).some((x) => x.key === "exclude-roi")).toBe(false);
    expect(buildBulkEquipmentActions([{ modelId: "m", excludeFromRoi: true }], ctx).some((x) => x.key === "exclude-roi")).toBe(false);
  });
});
