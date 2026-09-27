/**
 * #1296 build plan phase 3b — automated smoke coverage for the Manifest
 * react-pdf component tree, mirroring `packing-list-document.test.ts`'s bar
 * (render, no throw, page-count sanity — see that file's header comment for
 * why this codebase's react-pdf tests mostly stop there). Also proves the
 * container-header rendering path end-to-end (defect #2 from
 * docs/designs/packing-containers-manifest.md §1.5 — two items packed into
 * the same case, from different categories, must surface under ONE
 * container section, not two, and the container's own band must print once,
 * not once per doc-generic group-header mechanism) via real text extraction.
 */
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument as PdfLibDocument } from "@pdfme/pdf-lib";
import { ManifestDocument } from "./manifest-document";
import { makeSpikeData, makeLongLineItemList, makeMixedRentalSaleLineItems } from "./fixture";
import { structureLineItemsByContainer, type ContainerForStructuring } from "@/lib/pdfme/structure-line-items-by-container";
import { renderPdfPages } from "./pdf-test-utils";

async function pageCount(data: ReturnType<typeof makeSpikeData>) {
  const buffer = await renderToBuffer(ManifestDocument({ data }));
  const pdf = await PdfLibDocument.load(buffer);
  return pdf.getPageCount();
}

describe("ManifestDocument (react-pdf)", () => {
  it("renders a single-page manifest with no line items", async () => {
    const data = makeSpikeData({ line_items: [], total_items: 0 });
    expect(await pageCount(data)).toBe(1);
  });

  it("paginates a long, varied line-item list across multiple pages with no throw", async () => {
    const items = makeLongLineItemList(60);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const pages = await pageCount(data);
    expect(pages).toBeGreaterThanOrEqual(3);
  });

  it("expands kit/group/accessory children (showKitChildren on)", async () => {
    const items = makeLongLineItemList(1);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    await expect(pageCount(data)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("renders every header mode (logo/icon/none) without throwing", async () => {
    const items = makeLongLineItemList(1);
    for (const documentLogoMode of ["logo", "icon", "none"] as const) {
      const data = makeSpikeData({
        line_items: items,
        total_items: items.length,
        org_logo: documentLogoMode === "logo" ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" : null,
        org_icon: documentLogoMode === "icon" ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" : null,
        org_branding: { documentLogoMode, showOrgNameOnDocuments: true, documentColor: "#0d4f4f" },
      });
      await expect(pageCount(data)).resolves.toBeGreaterThanOrEqual(1);
    }
  });

  it("renders the mixed rental + SALE fixture (WS11 #950) without throwing", async () => {
    const items = makeMixedRentalSaleLineItems();
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    await expect(pageCount(data)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("renders the summary line with container/loose counts", async () => {
    const data = makeSpikeData({
      line_items: [],
      total_items: 5,
      total_weight: 42,
      container_count: 2,
      nested_container_count: 1,
      loose_item_count: 3,
    });
    const { fullText } = await renderPdfPages(ManifestDocument({ data }));
    expect(fullText).toContain("2 containers");
    expect(fullText).toContain("+1 nested");
    expect(fullText).toContain("5 items");
    expect(fullText).toContain("42 kg");
    expect(fullText).toContain("3 loose items");
  });

  describe("container structuring (defect #2, §1.5) end to end", () => {
    it("two items packed into the same case, from different categories, surface under one section with ONE header band", async () => {
      const containers: ContainerForStructuring[] = [{ id: "c1", kind: "CUSTOM", label: "Case 12", sortOrder: 0 }];
      const raw = [
        {
          id: "a", description: "Par Can", categoryName: "Lighting",
          quantity: 1, checkedOutQuantity: 0, unitPrice: null, pricingType: "PER_DAY" as const, duration: 1,
          discount: null, lineTotal: null, groupName: null, groupTitle: null,
          isOptional: false, notes: null, status: "CHECKED_OUT" as const, model: null, asset: null, bulkAsset: null,
          units: [{ id: "u-a", asset: { assetTag: "PC-1" }, bulkAsset: null, status: "CHECKED_OUT" as const, containerId: "c1" }],
        },
        {
          id: "b", description: "DMX Cable", categoryName: "Audio",
          quantity: 1, checkedOutQuantity: 0, unitPrice: null, pricingType: "PER_DAY" as const, duration: 1,
          discount: null, lineTotal: null, groupName: null, groupTitle: null,
          isOptional: false, notes: null, status: "CHECKED_OUT" as const, model: null, asset: null, bulkAsset: null,
          units: [{ id: "u-b", asset: { assetTag: "DMX-1" }, bulkAsset: null, status: "CHECKED_OUT" as const, containerId: "c1" }],
        },
      ];
      const structured = structureLineItemsByContainer(raw as never, containers);
      const data = makeSpikeData({ line_items: structured, total_items: 2 });
      const { fullText } = await renderPdfPages(ManifestDocument({ data }));

      expect(fullText).toContain("Par Can");
      expect(fullText).toContain("DMX Cable");
      // The section header prints once — not once from the generic
      // GroupHeaderRow mechanism AND once from ContainerHeaderRow.
      expect(fullText.split("Case 12").length - 1).toBe(1);
    });

    it("Loose items (no container) still print under a Loose section", async () => {
      const raw = [
        {
          id: "z", description: "Spare Cable", categoryName: "Audio",
          quantity: 1, checkedOutQuantity: 0, unitPrice: null, pricingType: "PER_DAY" as const, duration: 1,
          discount: null, lineTotal: null, groupName: null, groupTitle: null,
          isOptional: false, notes: null, status: "CHECKED_OUT" as const, model: null, asset: null, bulkAsset: null,
        },
      ];
      const structured = structureLineItemsByContainer(raw as never, []);
      const data = makeSpikeData({ line_items: structured, total_items: 1 });
      const { fullText } = await renderPdfPages(ManifestDocument({ data }));
      expect(fullText).toContain("Loose");
      expect(fullText).toContain("Spare Cable");
    });
  });
});
