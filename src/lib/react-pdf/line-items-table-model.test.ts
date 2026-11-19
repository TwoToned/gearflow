/**
 * `buildLineItemsTableModel` — the decisions `LineItemsTable` used to make
 * inline while drawing, now data the PDF and the Equipment tab's Client view
 * both read. The per-function rules (filtering, row display, cell text) keep
 * their own coverage in `components/__tests__/line-items-table.test.ts`.
 */
import { describe, it, expect } from "vitest";
import type { DocumentLineItem } from "@/lib/pdfme/types";
import { buildLineItemsTableModel, QUOTE_TABLE_CONFIG, type TableModelConfig } from "./line-items-table-model";

function makeItem(overrides: Partial<DocumentLineItem>): DocumentLineItem {
  return {
    id: overrides.id ?? "li-1",
    description: null,
    quantity: 1,
    checkedOutQuantity: 0,
    unitPrice: null,
    pricingType: "PER_DAY",
    duration: 1,
    discount: null,
    lineTotal: null,
    groupName: null,
    categoryName: null,
    groupTitle: null,
    isOptional: false,
    notes: null,
    status: "CONFIRMED",
    model: null,
    asset: null,
    bulkAsset: null,
    ...overrides,
  };
}

const WAREHOUSE: TableModelConfig = {
  ...QUOTE_TABLE_CONFIG,
  documentType: "packing-list",
  showKitChildren: true,
  showPricing: false,
  filterByStatus: null,
};

describe("buildLineItemsTableModel", () => {
  it("prints a plain header per named section and none for the ungrouped bucket", () => {
    const model = buildLineItemsTableModel(
      [makeItem({ id: "a", groupName: "Audio" }), makeItem({ id: "b" })],
      QUOTE_TABLE_CONFIG,
    );
    expect(model.sections.map((s) => [s.key, s.header])).toEqual([
      ["Audio", { name: "Audio", rollupAmount: null }],
      ["_ungrouped", null],
    ]);
  });

  it("suppresses the plain header when a depth-0 container row carries the title", () => {
    const model = buildLineItemsTableModel(
      [
        makeItem({ id: "case", groupName: "LX-02", isContainerRow: true, containerDepth: 0 }),
        makeItem({ id: "a", groupName: "LX-02" }),
      ],
      WAREHOUSE,
    );
    expect(model.sections[0].header).toBeNull();
    expect(model.sections[0].rows.map((r) => r.kind)).toEqual(["container", "item"]);
  });

  it("puts a rolled-up category's one price on its header, revealed rows included", () => {
    const model = buildLineItemsTableModel(
      [
        makeItem({ id: "a", groupName: "Lighting", rollupCategory: true, priceHidden: true, lineTotal: 300 }),
        makeItem({ id: "b", groupName: "Lighting", rollupCategory: true, lineTotal: 120 }),
      ],
      QUOTE_TABLE_CONFIG,
    );
    expect(model.sections[0].header).toEqual({ name: "Lighting", rollupAmount: 420 });
  });

  it("numbers item rows across sections, skipping container rows", () => {
    const model = buildLineItemsTableModel(
      [
        makeItem({ id: "case", groupName: "A", isContainerRow: true, containerDepth: 0 }),
        makeItem({ id: "a", groupName: "A" }),
        makeItem({ id: "b", groupName: "B" }),
      ],
      WAREHOUSE,
    );
    const nums = model.sections.flatMap((s) => s.rows.flatMap((r) => (r.kind === "item" ? [r.rowNum] : [])));
    expect(nums).toEqual([1, 2]);
  });

  it("renders a group's disclosed members on a client doc, but never kit or accessory children", () => {
    const member = makeItem({ id: "m1", isKitChild: true });
    const group = makeItem({ id: "g", groupName: "Audio", isGroupRow: true, childLineItems: [member] });
    const kit = makeItem({ id: "k", groupName: "Audio", kitId: "kit-1", childLineItems: [makeItem({ id: "kc", isKitChild: true })] });
    const accParent = makeItem({
      id: "p",
      groupName: "Audio",
      childLineItems: [makeItem({ id: "acc", isKitChild: true, childKind: "ACCESSORY" })],
    });
    const rows = buildLineItemsTableModel([group, kit, accParent], QUOTE_TABLE_CONFIG).sections[0].rows;
    const children = rows.map((r) => (r.kind === "item" ? r.children?.map((c) => c.item.id) ?? null : null));
    expect(children).toEqual([["m1"], null, null]);
  });

  it("status-filters the children a warehouse doc renders", () => {
    const kit = makeItem({
      id: "k",
      groupName: "Audio",
      kitId: "kit-1",
      status: "CHECKED_OUT",
      childLineItems: [
        makeItem({ id: "out", isKitChild: true, status: "CHECKED_OUT" }),
        makeItem({ id: "home", isKitChild: true, status: "CONFIRMED" }),
      ],
    });
    const row = buildLineItemsTableModel([kit], { ...WAREHOUSE, filterByStatus: ["CHECKED_OUT"] }).sections[0].rows[0];
    expect(row.kind === "item" && row.children?.map((c) => c.item.id)).toEqual(["out"]);
  });

  it("lists a disclosed member's own accessories as its grandchildren", () => {
    const acc = makeItem({ id: "acc", isKitChild: true, childKind: "ACCESSORY" });
    const member = makeItem({ id: "m1", isKitChild: true, childLineItems: [acc] });
    const group = makeItem({ id: "g", groupName: "Audio", isGroupRow: true, childLineItems: [member] });
    const row = buildLineItemsTableModel([group], QUOTE_TABLE_CONFIG).sections[0].rows[0];
    expect(row.kind === "item" && row.children?.[0].grandchildren.map((c) => c.id)).toEqual(["acc"]);
  });
});
