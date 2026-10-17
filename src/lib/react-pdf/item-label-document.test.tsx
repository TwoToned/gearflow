/**
 * Item labels (FEATUREDOCS/83) — renders the real component tree off the real
 * structuring step, for each shape of loose item: serialised, bulk, custom,
 * sub-hired.
 */
import { describe, it, expect } from "vitest";
import { ItemLabelDocument } from "./item-label-document";
import { makeSpikeData } from "./fixture";
import { renderPdfPages } from "./pdf-test-utils";
import { structureLineItemsByContainer } from "@/lib/pdfme/structure-line-items-by-container";
import { buildItemLabels, buildLabelIndex } from "@/lib/pdfme/container-labels";
import type { DocumentLineItem } from "@/lib/pdfme/types";

function li(o: Partial<DocumentLineItem>): DocumentLineItem {
  return { id: "li", description: null, quantity: 1, checkedOutQuantity: 0, unitPrice: null, pricingType: "PER_DAY", duration: 1, discount: null, lineTotal: null, groupName: null, categoryName: null, groupTitle: null, isOptional: false, notes: null, status: "CONFIRMED", model: null, asset: null, bulkAsset: null, ...o };
}
const unit = (id: string, tag: string | null, containerId: string | null = null, bulkTag: string | null = null) =>
  ({ id, asset: tag ? { assetTag: tag } : null, bulkAsset: bulkTag ? { assetTag: bulkTag } : null, status: "PACKED", containerId });

const lav = li({ id: "lav", childKind: "ACCESSORY", isKitChild: true, model: { name: "Clamp" }, quantity: 4 });
const items: DocumentLineItem[] = [
  li({ id: "shield", model: { name: "Drum Shield", modelNumber: "DS-5", category: { name: "Staging" } }, units: [unit("u1", "ACC-0042")], childLineItems: [lav] }),
  li({ id: "cable", model: { name: "XLR 5m" }, quantity: 12, units: [unit("b1", null, null, "BULK-XLR5")] }),
  li({ id: "custom", description: "Gaff tape (house stock)", quantity: 3 }),
  li({ id: "hire", model: { name: "Moving Head" }, quantity: 2, subHireId: "sh1", supplierName: "Mainstage AV" }),
  // Not item-label material:
  li({ id: "cased", model: { name: "Cased Mic" }, units: [unit("c1", "TTP1", "c1")] }),
  li({ id: "kit", kitId: "k1", kit: { assetTag: "KIT1", name: "RF Kit" }, description: "RF Kit" }),
  li({ id: "labour", type: "LABOUR", description: "Stagehand" }),
  li({ id: "sale", type: "SALE", description: "Gaffer tape sale" }),
  li({ id: "kidx", isKitChild: true, childKind: "KIT", model: { name: "Kit member" } }),
];
const rows = () => structureLineItemsByContainer(items, [{ id: "c1", kind: "CUSTOM", label: "Titan", sortOrder: 0 }]);
const data = () => makeSpikeData({ line_items: rows(), client_name: "Hilton Brisbane", project_name: "Annual Gala" });

describe("buildItemLabels", () => {
  it("labels loose serialised, bulk, custom and sub-hired lines — and nothing else", () => {
    const labels = buildItemLabels(rows());
    expect(labels.map((l) => [l.title, l.kind, l.qty, l.tag, l.supplierName])).toEqual([
      ["Drum Shield", "ASSET", 1, "ACC-0042", null],
      ["Gaff tape (house stock)", "CUSTOM", 3, null, null],
      ["Moving Head", "CUSTOM", 2, null, "Mainstage AV"],
      ["XLR 5m", "BULK", 12, "BULK-XLR5", null],
    ]);
    expect(labels[0].accessories).toEqual([{ qty: 4, name: "Clamp" }]);
    expect(labels[0].subtitle).toBe("Staging · DS-5");
  });

  it("gives each serialised unit of a multi-unit line its own label, accessories on the first", () => {
    const stands = li({ id: "stands", model: { name: "Stand" }, quantity: 2, units: [unit("s1", "STD-1"), unit("s2", "STD-2")], childLineItems: [lav] });
    const labels = buildItemLabels(structureLineItemsByContainer([stands], []));
    expect(labels.map((l) => [l.id, l.tag, l.qty, l.accessories.length])).toEqual([["stands:STD-1", "STD-1", 1, 1], ["stands:STD-2", "STD-2", 1, 0]]);
  });

  it("indexes the same labels for the menus", () => {
    expect(buildLabelIndex("item", rows()).map((e) => e.title)).toEqual(["Drum Shield", "Gaff tape (house stock)", "Moving Head", "XLR 5m"]);
    expect(buildLabelIndex("kit", rows()).map((e) => e.title)).toEqual(["RF Kit"]);
  });
});

describe("ItemLabelDocument", () => {
  it("prints the item, its tag, accessories, the job and the sub-hire supplier", async () => {
    const { fullText } = await renderPdfPages(<ItemLabelDocument data={data()} />);
    for (const s of ["Drum Shield", "ACC-0042", "4x Clamp", "Hilton Brisbane", "Annual Gala", "BULK-XLR5", "12x", "Gaff tape (house stock)", "Sub-hire · Mainstage AV"]) {
      expect(fullText).toContain(s);
    }
    expect(fullText).not.toContain("Cased Mic");
    expect(fullText).not.toContain("Stagehand");
  });

  it("prints only the requested label", async () => {
    const { fullText } = await renderPdfPages(<ItemLabelDocument data={data()} labelId="shield" />);
    expect(fullText).toContain("Drum Shield");
    expect(fullText).not.toContain("BULK-XLR5");
  });

  it("says so when nothing is loose", async () => {
    const { fullText } = await renderPdfPages(<ItemLabelDocument data={makeSpikeData({ line_items: [] })} />);
    expect(fullText).toContain("No loose items on this job");
  });
});
