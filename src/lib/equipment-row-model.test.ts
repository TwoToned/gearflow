import { describe, it, expect } from "vitest";

import type { LineItemData } from "@/components/projects/equipment-row-types";
import { equipmentRowModel, rowKind, stageOf } from "./equipment-row-model";

const line = (over: Partial<LineItemData> = {}): LineItemData => ({
  id: "l1",
  description: "Source Four",
  quantity: 4,
  unitPrice: 25,
  lineTotal: 100,
  ...over,
});

describe("equipmentRowModel", () => {
  it("maps a plain gear line to qty / unit / total facts with no tag", () => {
    const m = equipmentRowModel(line());
    expect(m.kind).toBe("gear");
    expect(m.title).toBe("Source Four");
    expect(m.tags).toEqual([]);
    expect(m.facts.qty).toEqual({ kind: "qty", value: 4 });
    expect(m.facts.unit).toEqual({ kind: "money", amount: 25 });
    expect(m.facts.total).toEqual({ kind: "money", amount: 100 });
    expect(m.facts.availability).toEqual({ kind: "availability", state: "ok" });
  });

  it("$0 is a price, a missing price is BLANK and flagged Unpriced", () => {
    const free = equipmentRowModel(line({ unitPrice: 0, lineTotal: 0 }));
    expect(free.facts.unit).toEqual({ kind: "money", amount: 0 });
    expect(free.flags).toEqual([]);
    const blank = equipmentRowModel(line({ unitPrice: null, lineTotal: null }));
    expect(blank.facts.unit).toEqual({ kind: "money", amount: null });
    expect(blank.facts.total).toEqual({ kind: "money", amount: null });
    expect(blank.flags).toContainEqual({ label: "Unpriced", tone: "warning" });
  });

  it("an overbooked line reads Short n in error; pencilled-only is a warning", () => {
    const base = { overBy: 2, totalStock: 4, effectiveStock: 4, totalBooked: 6 };
    const hard = equipmentRowModel(line(), { overbooked: { ...base, hardOverBy: 2 } });
    expect(hard.flags).toContainEqual({ label: "Short 2", tone: "error" });
    expect(hard.facts.availability).toEqual({ kind: "availability", state: "short", short: 2 });
    const pencil = equipmentRowModel(line(), { overbooked: { ...base, hardOverBy: 0 } });
    expect(pencil.flags).toContainEqual({ label: "Short 2", tone: "warning" });
  });

  it("kinds and tags: kit, sub-hire, custom, sale", () => {
    expect(rowKind(line({ kitId: "k1" }))).toBe("kit");
    expect(rowKind(line({ subHireId: "s1" }))).toBe("subhire");
    expect(rowKind(line({ isCustomItem: true }))).toBe("custom");
    expect(rowKind(line({ type: "SALE" }))).toBe("sale");
    expect(equipmentRowModel(line({ kitId: "k1" })).tags).toEqual(["Kit"]);
    const sub = equipmentRowModel(line({ subHireId: "s1", supplier: { name: "Scene Change" } }));
    expect(sub.facts.availability).toEqual({ kind: "text", label: "External · Scene Change" });
  });

  it("glyphs: rollup hides price unless revealed; optional, ROI, manual price, marker, case", () => {
    const hidden = equipmentRowModel(line(), { inRollupCategory: true });
    expect(hidden.glyphs.map((g) => g.key)).toContain("priceHidden");
    const shown = equipmentRowModel(line({ revealPriceInRollup: true }), { inRollupCategory: true });
    expect(shown.glyphs.map((g) => g.key)).not.toContain("priceHidden");
    // The flag is only consulted inside a rollup: a stale `true` outside changes nothing.
    expect(equipmentRowModel(line()).glyphs).toEqual([]);
    const all = equipmentRowModel(line({ isOptional: true, excludeFromRoi: true, priceOverridden: true }), {
      hasOpenMarker: true,
      plannedCaseLabel: "LX-04",
    });
    expect(all.glyphs.map((g) => g.key)).toEqual(["optional", "excludedFromRoi", "manualPrice", "needsCheck", "plannedCase"]);
    expect(all.glyphs.at(-1)?.tooltip).toBe("Planned → LX-04");
  });

  it("stage words come from the line's own state", () => {
    expect(stageOf(line())).toBeUndefined();
    expect(stageOf(line({ status: "CHECKED_OUT", prepStatus: "PACKED" }))).toBe("deployed");
    expect(stageOf(line({ prepStatus: "PACKED" }))).toBe("prepped");
    expect(stageOf(line({ status: "RETURNED" }))).toBe("returned");
  });

  it("subtitle joins serials, supplier (only when shown on docs), case and note", () => {
    const m = equipmentRowModel(
      line({ units: [{ id: "u", ordinal: 1, asset: { id: "a", assetTag: "LX-01" } }], notes: "gel in bag" }),
      { plannedCaseLabel: "LX-04" },
    );
    expect(m.subtitle).toBe("LX-01 · LX-04 · gel in bag");
  });
});
