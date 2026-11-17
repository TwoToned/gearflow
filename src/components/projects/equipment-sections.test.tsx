import { describe, it, expect } from "vitest";

import { buildEquipmentSections, equipmentColumns, type EquipmentHandlers, type EquipmentSectionsInput } from "./equipment-sections";
import type { CategoryData, GroupData, LineItemData } from "./equipment-row-types";
import { visibleRowIds } from "@/components/ui/line-row";

const line = (id: string) =>
  ({ id, description: `Line ${id}`, quantity: 1, unitPrice: 10, lineTotal: 10, type: "EQUIPMENT", model: { name: "M" } }) as unknown as LineItemData;
const group = (id: string, items: LineItemData[]) =>
  ({ id, title: `Group ${id}`, quantity: 1, price: 100, sortOrder: 0, lineItems: items }) as unknown as GroupData;

const cat = {
  id: "c1",
  name: "Audio",
  sortOrder: 0,
  groups: [group("g1", [line("m1")])],
  lineItems: [line("a"), line("b"), line("c")],
  // stored order: a, group g1, b, c  (loose lines interleave with the group)
  mixedGroups: [
    { kind: "lineItem", sortOrder: 0, lineItemId: "a" },
    { kind: "project", sortOrder: 1, projectGroupId: "g1" },
    { kind: "lineItem", sortOrder: 2, lineItemId: "b" },
    { kind: "lineItem", sortOrder: 3, lineItemId: "c" },
  ],
} as unknown as CategoryData;

function input(over: Partial<EquipmentSectionsInput> = {}): EquipmentSectionsInput {
  return {
    categories: [cat],
    uncategorizedItems: [],
    orphanProjectGroups: [],
    orphanSubHireGroups: [],
    collapsedCategories: new Set(),
    expandedGroups: new Set(["g1"]),
    pendingRemovalIds: new Set(),
    overbookedMap: {},
    draftSubHireIds: new Set(),
    moneyLocked: false,
    canDrag: true,
    showCost: false,
    handlers: {} as EquipmentHandlers,
    ...over,
  };
}

describe("buildEquipmentSections", () => {
  it("keeps the stored order: loose lines after a group become a headless continuation", () => {
    const { sections, rowMeta, sectionMeta } = buildEquipmentSections(input());
    expect(sections.map((s) => [s.section.id, !!s.headless, s.rows.map((r) => r.id)])).toEqual([
      ["cat-c1", false, ["a"]],
      ["grp-g1", false, ["m1"]],
      ["mix-c1-2", true, ["b", "c"]],
      ["uncat-zone", false, []],
    ]);
    expect(sections[1].section.depth).toBe(1);
    expect(rowMeta.get("b")).toMatchObject({ sortableId: "li-b", containerId: "mixed:c1", items: ["li-a", "grp-g1", "li-b", "li-c"] });
    expect(rowMeta.get("m1")).toMatchObject({ containerId: "items:g1" });
    expect(sectionMeta.get("grp-g1")).toMatchObject({ containerId: "mixed:c1", disabled: false });
    expect(sectionMeta.get("cat-c1")).toMatchObject({ containerId: "categories" });
  });

  it("a collapsed category and a collapsed group hide their rows from the visible ids", () => {
    const closedGroup = buildEquipmentSections(input({ expandedGroups: new Set() }));
    expect(visibleRowIds(closedGroup.sections)).toEqual(["a", "b", "c"]);
    const closedCat = buildEquipmentSections(input({ collapsedCategories: new Set(["c1"]) }));
    expect(visibleRowIds(closedCat.sections)).toEqual([]);
  });

  it("cannot drag without permission; the Cost column is opt-in", () => {
    const { rowMeta } = buildEquipmentSections(input({ canDrag: false }));
    expect(rowMeta.get("a")?.disabled).toBe(true);
    expect(equipmentColumns(false).some((c) => c.id === "cost")).toBe(false);
    const ids = equipmentColumns(true).map((c) => c.id);
    expect(ids.indexOf("cost")).toBe(ids.indexOf("total") - 1);
  });
});
