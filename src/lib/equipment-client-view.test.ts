import { describe, it, expect } from "vitest";
import type { DocumentLineItem } from "@/lib/pdfme/types";
import { buildLineItemsTableModel, QUOTE_TABLE_CONFIG } from "@/lib/react-pdf/line-items-table-model";
import { toClientViewSections } from "./equipment-client-view";

function makeItem(overrides: Partial<DocumentLineItem>): DocumentLineItem {
  return {
    id: overrides.id ?? "li-1",
    description: null,
    quantity: 1,
    checkedOutQuantity: 0,
    unitPrice: null,
    pricingType: "FLAT",
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

const view = (items: DocumentLineItem[]) => toClientViewSections(buildLineItemsTableModel(items, QUOTE_TABLE_CONFIG), QUOTE_TABLE_CONFIG);

describe("toClientViewSections", () => {
  it("prints a rolled-up category as one price with blank row money", () => {
    const [section] = view([
      makeItem({ id: "a", description: "Wash", groupName: "Lighting", rollupCategory: true, priceHidden: true, unitPrice: 60, lineTotal: 360 }),
      makeItem({ id: "b", description: "Spot", groupName: "Lighting", rollupCategory: true, unitPrice: 85, lineTotal: 85 }),
    ]);
    expect(section.title).toBe("Lighting");
    expect(section.rollupText).toBe("$445.00");
    expect(section.rows.map((r) => [r.name, r.unitPrice, r.total, r.priceHidden])).toEqual([
      ["Wash", "", "", true],
      ["Spot", "$85.00", "$85.00", false],
    ]);
  });

  it("gives the ungrouped bucket no title and keeps the PDF's dash for a missing price", () => {
    const [section] = view([makeItem({ id: "a", description: "Rig" })]);
    expect(section.title).toBeNull();
    expect(section.rows[0]).toMatchObject({ name: "Rig", qty: "1", unitPrice: "-", discount: "-", total: "—" });
  });

  it("lists a group's disclosed members without a price, and marks optional lines", () => {
    const member = makeItem({ id: "m", description: "Gooseneck", quantity: 2, isKitChild: true, priceHidden: true });
    const [section] = view([
      makeItem({ id: "g", description: "Lectern package", groupName: "Audio", isGroupRow: true, childLineItems: [member], lineTotal: 850 }),
      makeItem({ id: "o", description: "Hazer", groupName: "Audio", isOptional: true, lineTotal: 90 }),
    ]);
    expect(section.rows[0].children).toEqual([{ id: "m", name: "Gooseneck", qty: "2", children: [] }]);
    expect(section.rows[1].isOptional).toBe(true);
  });

  it("joins the PDF's note lines into the subtitle", () => {
    const [section] = view([
      makeItem({ id: "s", description: "AD4Q", groupName: "Audio", subHireId: "sh", showSubhireOnDocs: true, supplierName: "Scene Change" }),
    ]);
    expect(section.rows[0].subtitle).toBe("via Scene Change");
  });
});
