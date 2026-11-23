// UX Phase 8 (§7b.3) — the Packing tab's pure planning rules: the glyph rule,
// who can be dragged, what a drop does, filters, counts, footer facts.
import { describe, test, expect } from "vitest";
import {
  canDragLine,
  filterPlannableLines,
  lineSubtitle,
  NO_PACKING_FILTERS,
  packingCounts,
  packingFiltersActive,
  packingFooterFacts,
  planGlyph,
  resolveDrop,
  type PlannableLine,
} from "./packing-tab";
import { buildPackingBulkActions, buildPackingLineActions } from "./row-actions/packing-line";
import { isPlannableLine } from "../../convex/lib/packingPlan";
import type { LineItemData } from "@/components/projects/equipment-rows";

function line(overrides: Partial<LineItemData> & { id: string }): LineItemData {
  return {
    description: "Item", quantity: 1, unitPrice: null, lineTotal: null, type: "EQUIPMENT",
    status: "CONFIRMED", isKitChild: false, isContainerLineItem: false,
    ...overrides,
  };
}
const asLine = (item: LineItemData, categoryName = "Lighting"): PlannableLine => ({ item, categoryName });
const labels = new Map([["lx", "LX-02"], ["vid", "VID-04"]]);
const packedIn = (containerId: string) => [{ id: "u1", ordinal: 1, containerId }];

describe("planGlyph (the glyph rule)", () => {
  test("unplanned and planned-not-packed carry no glyph: the card says it", () => {
    expect(planGlyph(line({ id: "a" }), labels)).toEqual({ packed: false, plannedElsewhere: null });
    expect(planGlyph(line({ id: "a", plannedContainerId: "lx" }), labels)).toEqual({ packed: false, plannedElsewhere: null });
  });
  test("packed with no plan, or a plan that agrees, is just Packed", () => {
    expect(planGlyph(line({ id: "a", units: packedIn("lx") }), labels)).toEqual({ packed: true, plannedElsewhere: null });
    expect(planGlyph(line({ id: "a", units: packedIn("lx"), plannedContainerId: "lx" }), labels)).toEqual({ packed: true, plannedElsewhere: null });
  });
  test("packed in one case but planned for another says Planned → X (only on disagreement)", () => {
    expect(planGlyph(line({ id: "a", units: packedIn("lx"), plannedContainerId: "vid" }), labels)).toEqual({
      packed: true,
      plannedElsewhere: "Planned → VID-04",
    });
    expect(planGlyph(line({ id: "a", units: packedIn("lx"), plannedContainerId: "gone" }), labels).plannedElsewhere).toBe("Planned → another case");
  });
});

describe("ONE plannable-line predicate (shared by the tab, readiness and the versions facts)", () => {
  test("top-level, non-cancelled equipment only", () => {
    expect(isPlannableLine({ type: "EQUIPMENT", status: "CONFIRMED" })).toBe(true);
    expect(isPlannableLine({ type: "EQUIPMENT", isKitChild: true })).toBe(false);
    expect(isPlannableLine({ type: "EQUIPMENT", isContainerLineItem: true })).toBe(false);
    expect(isPlannableLine({ type: "EQUIPMENT", status: "CANCELLED" })).toBe(false);
    expect(isPlannableLine({ type: "SERVICE" })).toBe(false);
  });
});

describe("ONE packed predicate (isPackedUnit, shared with the server)", () => {
  test("ANY non-cancelled unit in a case is packed, even when most of its siblings are loose", () => {
    const units = [{ id: "u1", ordinal: 1, containerId: null }, { id: "u2", ordinal: 2, containerId: null }, { id: "u3", ordinal: 3, containerId: "lx" }];
    expect(planGlyph(line({ id: "a", units }), labels).packed).toBe(true);
    expect(packingCounts([asLine(line({ id: "a", units }))])).toEqual({ planned: 1, total: 1 });
  });
  test("a cancelled unit in a case is not packed (the line stays plannable)", () => {
    const units = [{ id: "u1", ordinal: 1, containerId: "lx", status: "CANCELLED" }];
    expect(planGlyph(line({ id: "a", units }), labels).packed).toBe(false);
    expect(canDragLine(line({ id: "a", units }))).toBe(true);
  });
});

describe("canDragLine / packingCounts / footer", () => {
  test("a packed line cannot be dragged; planned and unplanned can", () => {
    expect(canDragLine(line({ id: "a", units: packedIn("lx") }))).toBe(false);
    expect(canDragLine(line({ id: "a", plannedContainerId: "lx" }))).toBe(true);
    expect(canDragLine(line({ id: "a" }))).toBe(true);
  });
  test("Packing n/m counts planned-or-packed over plannable lines", () => {
    const lines = [line({ id: "a" }), line({ id: "b", plannedContainerId: "lx" }), line({ id: "c", units: packedIn("lx") })].map((l) => asLine(l));
    expect(packingCounts(lines)).toEqual({ planned: 2, total: 3 });
    expect(packingCounts([])).toEqual({ planned: 0, total: 0 });
  });
  test("footer: lines, units (sum of quantity) and packed lines", () => {
    const lines = [line({ id: "a", quantity: 4 }), line({ id: "b", quantity: 2, units: packedIn("lx") })].map((l) => asLine(l));
    expect(packingFooterFacts(lines)).toEqual({ lines: 2, units: 6, packed: 1 });
  });
});

describe("filterPlannableLines", () => {
  const lines = [
    asLine(line({ id: "a", description: "MAC Aura" }), "Lighting"),
    asLine(line({ id: "b", description: "LED panel", plannedContainerId: "lx" }), "Video"),
    asLine(line({ id: "c", description: "Mic", units: packedIn("lx") }), "Audio"),
  ];
  test("search matches name or category, case-insensitively", () => {
    expect(filterPlannableLines(lines, { ...NO_PACKING_FILTERS, search: "aura" }).map((l) => l.item.id)).toEqual(["a"]);
    expect(filterPlannableLines(lines, { ...NO_PACKING_FILTERS, search: "VIDEO" }).map((l) => l.item.id)).toEqual(["b"]);
  });
  test("category and status narrow independently and together", () => {
    expect(filterPlannableLines(lines, { ...NO_PACKING_FILTERS, category: "Audio" }).map((l) => l.item.id)).toEqual(["c"]);
    expect(filterPlannableLines(lines, { ...NO_PACKING_FILTERS, status: "unplanned" }).map((l) => l.item.id)).toEqual(["a"]);
    expect(filterPlannableLines(lines, { ...NO_PACKING_FILTERS, status: "planned" }).map((l) => l.item.id)).toEqual(["b"]);
    expect(filterPlannableLines(lines, { ...NO_PACKING_FILTERS, status: "packed" }).map((l) => l.item.id)).toEqual(["c"]);
    expect(filterPlannableLines(lines, { search: "led", category: "Lighting", status: "all" })).toEqual([]);
  });
  test("packingFiltersActive", () => {
    expect(packingFiltersActive(NO_PACKING_FILTERS)).toBe(false);
    expect(packingFiltersActive({ ...NO_PACKING_FILTERS, search: " " })).toBe(false);
    expect(packingFiltersActive({ ...NO_PACKING_FILTERS, status: "packed" })).toBe(true);
  });
});

describe("lineSubtitle", () => {
  test("category, then the muted tags", () => {
    expect(lineSubtitle(line({ id: "a" }), "Lighting")).toBe("Lighting");
    expect(lineSubtitle(line({ id: "a", kitId: "k1" }), "Lighting")).toBe("Lighting · Kit · moves whole");
    expect(lineSubtitle(line({ id: "a", subHireId: "s1", isCustomItem: true }), "Audio")).toBe("Audio · Sub-hire · Custom");
  });
});

describe("resolveDrop", () => {
  const open = { id: "lx", label: "LX-02", sealed: false };
  const all = () => true;
  test("an unticked row drags only itself; a ticked row drags the whole selection", () => {
    expect(resolveDrop({ activeId: "a", selected: new Set(), target: open, canDrag: all })).toEqual({ kind: "plan", ids: ["a"], target: { id: "lx", label: "LX-02" } });
    expect(resolveDrop({ activeId: "a", selected: new Set(["a", "b"]), target: open, canDrag: all })).toEqual({ kind: "plan", ids: ["a", "b"], target: { id: "lx", label: "LX-02" } });
    // dragging a row that is NOT ticked ignores the selection
    expect(resolveDrop({ activeId: "z", selected: new Set(["a", "b"]), target: open, canDrag: all })).toMatchObject({ ids: ["z"] });
  });
  test("a drop on the Unplanned card (null target) un-plans", () => {
    expect(resolveDrop({ activeId: "a", selected: new Set(), target: null, canDrag: all })).toEqual({ kind: "plan", ids: ["a"], target: null });
  });
  test("a sealed target refuses, naming Unseal", () => {
    const r = resolveDrop({ activeId: "a", selected: new Set(), target: { ...open, sealed: true }, canDrag: all });
    expect(r).toEqual({ kind: "refused", message: "LX-02 is sealed. Unseal it to plan lines into it." });
  });
  test("packed / locked lines are filtered out of the drag; nothing left refuses", () => {
    expect(resolveDrop({ activeId: "a", selected: new Set(["a", "p"]), target: open, canDrag: (id) => id !== "p" })).toMatchObject({ kind: "plan", ids: ["a"] });
    expect(resolveDrop({ activeId: "p", selected: new Set(), target: open, canDrag: () => false }).kind).toBe("refused");
  });
});

describe("buildPackingLineActions / buildPackingBulkActions", () => {
  const cases = [
    { id: "lx", label: "LX-02", sealed: false },
    { id: "vid", label: "VID-04", sealed: false },
    { id: "sl", label: "SEAL-01", sealed: true },
  ];
  const onPlanInto = () => {};
  test("Plan into… lists open cases except the current one; Unplan only when planned", () => {
    const spec = buildPackingLineActions({ id: "a", canPlan: true, plannedCase: { id: "lx", label: "LX-02", sealed: false } }, { cases, onPlanInto });
    expect(spec.items.map((i) => i.label)).toEqual(["Plan into…", "Unplan"]);
    expect(spec.items[0].children?.map((c) => c.label)).toEqual(["VID-04"]);
    const unplanned = buildPackingLineActions({ id: "a", canPlan: true, plannedCase: null }, { cases, onPlanInto });
    expect(unplanned.items.map((i) => i.label)).toEqual(["Plan into…"]);
    expect(unplanned.items[0].children?.map((c) => c.label)).toEqual(["LX-02", "VID-04"]);
  });
  test("a packed line, or a line inside a sealed case, has no ⋯ items", () => {
    expect(buildPackingLineActions({ id: "a", canPlan: false, plannedCase: null }, { cases, onPlanInto }).items).toEqual([]);
    expect(buildPackingLineActions({ id: "a", canPlan: true, plannedCase: { id: "sl", label: "SEAL-01", sealed: true } }, { cases, onPlanInto }).items).toEqual([]);
  });
  test("bulk verbs carry the count and never offer a sealed case", () => {
    const actions = buildPackingBulkActions({ cases, canUnplan: true, onPlanInto });
    expect(actions.map((a) => a.label(3))).toEqual(["Plan 3 into…", "Unplan 3"]);
    expect(actions[0].children?.map((c) => c.label(3))).toEqual(["LX-02", "VID-04"]);
  });
  test("Unplan is absent (not disabled) when no ticked line is planned", () => {
    const actions = buildPackingBulkActions({ cases, canUnplan: false, onPlanInto });
    expect(actions.map((a) => a.label(3))).toEqual(["Plan 3 into…"]);
  });
});
