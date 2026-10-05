/**
 * Container & kit labels (FEATUREDOCS/83) — renders the real component tree and
 * extracts text, since a label that "renders" can still print the wrong thing.
 */
import { describe, it, expect } from "vitest";
import { ContainerLabelDocument, splitColumns } from "./container-label-document";
import { makeSpikeData } from "./fixture";
import { renderPdfPages } from "./pdf-test-utils";
import { structureLineItemsByContainer } from "@/lib/pdfme/structure-line-items-by-container";
import type { DocumentLineItem } from "@/lib/pdfme/types";
import type { LabelLine } from "@/lib/pdfme/container-labels";

function li(o: Partial<DocumentLineItem>): DocumentLineItem {
  return { id: "li", description: null, quantity: 1, checkedOutQuantity: 0, unitPrice: null, pricingType: "PER_DAY", duration: 1, discount: null, lineTotal: null, groupName: null, categoryName: null, groupTitle: null, isOptional: false, notes: null, status: "CONFIRMED", model: null, asset: null, bulkAsset: null, ...o };
}
const unit = (id: string, tag: string | null, containerId: string | null) => ({ id, asset: tag ? { assetTag: tag } : null, bulkAsset: null, status: "PACKED", containerId });

function data(items: DocumentLineItem[]) {
  const rows = structureLineItemsByContainer(items, [
    { id: "c1", kind: "CUSTOM", label: "Titan AV Case", sortOrder: 0 },
    { id: "c2", kind: "CUSTOM", label: "Pelican 1450", sortOrder: 1 },
  ]);
  return makeSpikeData({ line_items: rows, client_name: "Rahul Ganguly", project_name: "Rahul Ganguly Dry Hire" });
}

const lav = li({ id: "lav", childKind: "ACCESSORY", isKitChild: true, model: { name: "Lav mic" }, quantity: 2, units: [unit("a", null, "c2"), unit("b", null, "c2")] });
const items = [li({ id: "p", model: { name: "EW-DX SK" }, quantity: 1, units: [unit("p1", "TTP00017", "c1")], childLineItems: [lav] })];

describe("ContainerLabelDocument", () => {
  it("prints client, project, container names, tags and the accessory pointers both ways", async () => {
    const { fullText } = await renderPdfPages(<ContainerLabelDocument data={data(items)} />);
    for (const s of ["Titan AV Case", "Pelican 1450", "Rahul Ganguly", "Rahul Ganguly Dry Hire", "TTP00017", "EW-DX SK", "to Pelican 1450", "accessory of EW-DX SK, packed in Titan AV Case"]) {
      expect(fullText).toContain(s);
    }
  });

  it("prints only the requested container when labelId is given", async () => {
    const { fullText } = await renderPdfPages(<ContainerLabelDocument data={data(items)} labelId="c2" />);
    expect(fullText).toContain("Pelican 1450");
    expect(fullText).not.toContain("TTP00017");
  });

  it("says so when the job has no kits", async () => {
    const { fullText } = await renderPdfPages(<ContainerLabelDocument data={data(items)} kind="kit" />);
    expect(fullText).toContain("No kits on this job");
  });
});

describe("splitColumns", () => {
  const l = (n: number): LabelLine => ({ qty: 1, name: `i${n}`, tags: [], accessories: [] });
  it("keeps order and balances by weight", () => {
    const [a, b] = splitColumns([l(1), l(2), l(3), l(4), l(5)]);
    expect([...a, ...b].map((x) => x.name)).toEqual(["i1", "i2", "i3", "i4", "i5"]);
    expect(a.length).toBe(3);
  });
  it("never throws on empty", () => expect(splitColumns([])).toEqual([[], []]));
});
