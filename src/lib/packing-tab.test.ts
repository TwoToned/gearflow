import { describe, test, expect } from "vitest";
import {
  collectPlannableLines,
  resolvePackingStatus,
  buildPackingBuckets,
  type PlannableLine,
} from "./packing-tab";
import type { CategoryData, GroupData, SubHireGroupData, LineItemData } from "@/components/projects/equipment-rows";

function line(overrides: Partial<LineItemData> & { id: string }): LineItemData {
  return {
    description: null,
    quantity: 1,
    unitPrice: null,
    lineTotal: null,
    type: "EQUIPMENT",
    status: "CONFIRMED",
    isKitChild: false,
    isContainerLineItem: false,
    ...overrides,
  };
}

function category(overrides: Partial<CategoryData> & { id: string; name: string }): CategoryData {
  return { sortOrder: 0, groups: [], ...overrides };
}

function group(overrides: Partial<GroupData> & { id: string; title: string }): GroupData {
  return { description: null, quantity: 1, price: null, discount: null, suggestedPrice: null, sortOrder: 0, ...overrides };
}

describe("collectPlannableLines (#1296 build plan phase 4)", () => {
  test("collects standalone category lines and uncategorized lines", () => {
    const cats = [category({ id: "c1", name: "Lighting", lineItems: [line({ id: "l1" })] })];
    const lines = collectPlannableLines(cats, [line({ id: "l2" })], [], []);
    expect(lines.map((l) => l.item.id)).toEqual(["l1", "l2"]);
    expect(lines.find((l) => l.item.id === "l1")?.categoryName).toBe("Lighting");
    expect(lines.find((l) => l.item.id === "l2")?.categoryName).toBe("Uncategorized");
  });

  test("collects a Project Group's own member lines under the group's category", () => {
    const cats = [
      category({
        id: "c1",
        name: "Audio",
        groups: [group({ id: "g1", title: "Wireless Mic Kit", lineItems: [line({ id: "l1" }), line({ id: "l2" })] })],
      }),
    ];
    const lines = collectPlannableLines(cats, [], [], []);
    expect(lines.map((l) => l.item.id).sort()).toEqual(["l1", "l2"]);
  });

  test("collects a sub-hire group's synthetic parent's children, never the parent itself", () => {
    const child = line({ id: "child" });
    const parent = line({ id: "parent", childLineItems: [child] });
    const subHireGroup: SubHireGroupData = {
      id: "sh1", title: "Sub-hire order", quantity: 1, cost: null, charge: null, sortOrder: 0,
      targetCategoryId: null, subHire: { id: "sh1", orderNumber: "SH-1", status: "ORDERED" }, lineItems: [parent],
    };
    const lines = collectPlannableLines([category({ id: "c1", name: "Audio", subHireGroupTargets: [subHireGroup] })], [], [], []);
    expect(lines.map((l) => l.item.id)).toEqual(["child"]);
  });

  test("excludes kit children, container line items, cancelled lines, and non-equipment lines", () => {
    const cats = [
      category({
        id: "c1",
        name: "Lighting",
        lineItems: [
          line({ id: "kit-child", isKitChild: true }),
          line({ id: "case", isContainerLineItem: true }),
          line({ id: "cancelled", status: "CANCELLED" }),
          line({ id: "sale", type: "SALE" }),
          line({ id: "kit-parent", kitId: "k1" }),
        ],
      }),
    ];
    const lines = collectPlannableLines(cats, [], [], []);
    // A kit parent IS plannable (one unit, D3's whole-kit convention) — only
    // its own children/cases/cancelled/non-equipment rows are excluded.
    expect(lines.map((l) => l.item.id)).toEqual(["kit-parent"]);
  });
});

describe("resolvePackingStatus", () => {
  test("unplanned when neither a plan nor any packed unit exists", () => {
    expect(resolvePackingStatus(line({ id: "l1" }))).toEqual({ kind: "unplanned" });
  });

  test("planned (muted, PM's intent) when plannedContainerId is set but nothing is packed yet", () => {
    expect(resolvePackingStatus(line({ id: "l1", plannedContainerId: "c1" }))).toEqual({ kind: "planned", containerId: "c1" });
  });

  test("packed (actual overrides plan) once a unit is really in a container, even a DIFFERENT one than planned", () => {
    const item = line({
      id: "l1",
      plannedContainerId: "c-planned",
      units: [{ id: "u1", ordinal: 1, containerId: "c-actual" }],
    });
    expect(resolvePackingStatus(item)).toEqual({ kind: "packed", containerId: "c-actual" });
  });
});

describe("buildPackingBuckets", () => {
  const asLine = (item: LineItemData): PlannableLine => ({ item, categoryName: "Lighting" });

  test("groups by resolved container, Not-planned bucket sorts last", () => {
    const buckets = buildPackingBuckets(
      [
        asLine(line({ id: "a", plannedContainerId: "c-z" })),
        asLine(line({ id: "b", plannedContainerId: "c-a" })),
        asLine(line({ id: "c" })),
      ],
      new Map([
        ["c-z", "Z Tub"],
        ["c-a", "A Case"],
      ]),
    );
    expect(buckets.map((b) => b.label)).toEqual(["A Case", "Z Tub", null]);
    expect(buckets[2].containerId).toBeNull();
    expect(buckets[2].lines.map((l) => l.item.id)).toEqual(["c"]);
  });
});
