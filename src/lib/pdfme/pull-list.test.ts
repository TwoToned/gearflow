import { describe, it, expect } from "vitest";
import { filterAndGroupItems } from "@/lib/react-pdf/line-items-table-model";
import type { DocumentLineItem } from "./types";
import { PULL_LIST_TABLE_CONFIG, toPullRow } from "./pull-list";

const item = (over: Partial<DocumentLineItem>): DocumentLineItem =>
  ({
    id: "l1", description: null, quantity: 1, checkedOutQuantity: 0, unitPrice: null, pricingType: "PER_DAY", duration: 1,
    discount: null, lineTotal: null, groupName: "Audio", categoryName: "Audio", groupTitle: null, isOptional: false,
    notes: null, status: "CONFIRMED", model: { name: "SM58", modelNumber: null }, asset: { assetTag: "SK-1" }, bulkAsset: null,
    locationName: "A-01", ...over,
  }) as DocumentLineItem;

describe("the pull list (one list for the PDF and the dialog, R-3.1)", () => {
  it("groups exactly as the pull-slip PDF does: kit children nest, never top-level", () => {
    const kit = item({ id: "k", kitId: "kit1", description: "Rack", kit: { assetTag: "K-1", name: "Rack" }, asset: null,
      childLineItems: [item({ id: "c", isKitChild: true, childKind: "KIT", kitId: "kit1", asset: { assetTag: "SK-2" } })] });
    const child = item({ id: "c", isKitChild: true, kitId: "kit1" });
    const { groups } = filterAndGroupItems([kit, child, item({ id: "m" })], PULL_LIST_TABLE_CONFIG);
    const rows = groups.get("Audio")!.map((i) => toPullRow(i));
    expect(rows.map((r) => r.id)).toEqual(["k", "m"]);
    expect(rows[0]).toMatchObject({ kind: "kit", name: "Rack", tag: "K-1" });
    expect(rows[0].children[0]).toMatchObject({ kind: "member", tag: "SK-2" });
  });

  it("a row carries its shelf, its supplier when hired in, and short when overbooked", () => {
    expect(toPullRow(item({ subHireId: "s1", supplierName: "Acme Hire", isOverbooked: true }))).toMatchObject({
      location: "A-01", supplier: "Acme Hire", short: "self",
    });
    expect(toPullRow(item({ isOverbooked: true, overbookedInherited: true })).short).toBe("inside");
    expect(toPullRow(item({})).short).toBeNull();
  });
});
