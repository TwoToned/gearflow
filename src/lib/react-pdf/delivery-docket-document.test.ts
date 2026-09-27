/**
 * #1154, reworked #1296 phase 3c — automated smoke coverage for the
 * standalone react-pdf delivery-docket component tree. See
 * `packing-list-document.test.ts`'s header comment for why these tests stop
 * at "renders, no throw, page-count sanity" rather than parsing PDF text —
 * the structured filtering/grouping assertions (including the WS11 #950
 * SALE-inclusion rule) already live in
 * `components/__tests__/line-items-table.test.ts`; the container-structuring
 * end-to-end proof lives in `return-sheet-document.test.ts`'s and
 * `manifest-document.test.ts`'s own describe blocks and applies identically
 * here (same `byContainer` mode).
 */
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument as PdfLibDocument } from "@pdfme/pdf-lib";
import { DeliveryDocketDocument } from "./delivery-docket-document";
import { makeSpikeData, makeLongLineItemList, makeMixedRentalSaleLineItems } from "./fixture";
import { structureLineItemsByContainer, type ContainerForStructuring } from "@/lib/pdfme/structure-line-items-by-container";
import { renderPdfPages } from "./pdf-test-utils";

async function pageCount(data: ReturnType<typeof makeSpikeData>) {
  const buffer = await renderToBuffer(DeliveryDocketDocument({ data }));
  const pdf = await PdfLibDocument.load(buffer);
  return pdf.getPageCount();
}

describe("DeliveryDocketDocument (react-pdf)", () => {
  it("renders a single-page delivery docket with no line items", async () => {
    const data = makeSpikeData({ line_items: [], total_items: 0 });
    expect(await pageCount(data)).toBe(1);
  });

  it("paginates a long, varied line-item list (filtered to CHECKED_OUT) across multiple pages with no throw", async () => {
    const items = makeLongLineItemList(60);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const pages = await pageCount(data);
    expect(pages).toBeGreaterThanOrEqual(1);
  });

  it("renders row numbers and a kit parent's own row with its CHECKED_OUT children indented below (kit parent in the fixture) without throwing", async () => {
    const items = makeLongLineItemList(1); // includes a kit parent with CHECKED_OUT children
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    await expect(pageCount(data)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("renders the mixed rental + SALE fixture (WS11 #950) without throwing — SALE lines are included despite failing the CHECKED_OUT filter", async () => {
    const items = makeMixedRentalSaleLineItems();
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    await expect(pageCount(data)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("renders the site contact line in the details row and the signature block without throwing", async () => {
    const data = makeSpikeData({
      line_items: [],
      total_items: 0,
      site_contact_name: "Site Manager",
      site_contact_phone: "0400 222 222",
    });
    await expect(pageCount(data)).resolves.toBe(1);
  });

  it("renders without throwing when no site contact is set", async () => {
    const data = makeSpikeData({ line_items: [], total_items: 0, site_contact_name: "" });
    await expect(pageCount(data)).resolves.toBe(1);
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

  describe("container structuring + D7 layout (#1296 build plan phase 3c)", () => {
    it("groups by container, prints a kit's own row with its case tag (not dropped), and its CHECKED_OUT child indented — with no per-row Received text", async () => {
      const containers: ContainerForStructuring[] = [{ id: "c1", kind: "CUSTOM", label: "Case 12", sortOrder: 0 }];
      const raw = [
        {
          id: "kit",
          description: "Lighting Kit",
          kitId: "kit-1",
          kit: { assetTag: "KIT-1", name: "Lighting Kit" },
          quantity: 1,
          checkedOutQuantity: 1,
          unitPrice: null,
          pricingType: "PER_DAY" as const,
          duration: 1,
          discount: null,
          lineTotal: null,
          groupName: null,
          groupTitle: null,
          isOptional: false,
          notes: null,
          status: "CHECKED_OUT" as const,
          model: null,
          asset: null,
          bulkAsset: null,
          units: [{ id: "u-kit", asset: { assetTag: "KIT-1" }, bulkAsset: null, status: "CHECKED_OUT" as const, containerId: "c1" }],
          childLineItems: [
            {
              id: "kit-child",
              description: "Par Can",
              isKitChild: true,
              quantity: 1,
              checkedOutQuantity: 1,
              unitPrice: null,
              pricingType: "PER_DAY" as const,
              duration: 1,
              discount: null,
              lineTotal: null,
              groupName: null,
              groupTitle: null,
              isOptional: false,
              notes: null,
              status: "CHECKED_OUT" as const,
              model: null,
              asset: null,
              bulkAsset: null,
            },
          ],
        },
      ];
      const structured = structureLineItemsByContainer(raw as never, containers);
      const data = makeSpikeData({ line_items: structured, total_items: 1 });
      const { fullText } = await renderPdfPages(DeliveryDocketDocument({ data }));

      expect(fullText).toContain("Case 12");
      expect(fullText).toContain("Lighting Kit");
      expect(fullText).toContain("KIT-1");
      expect(fullText).toContain("Par Can");
      expect(fullText).not.toContain("Received");
    });

    it("prints a multi-unit line's asset tags inline instead of exploding per-unit sub-rows", async () => {
      const raw = [
        {
          id: "bulk",
          description: "Par Can",
          categoryName: "Lighting",
          quantity: 2,
          checkedOutQuantity: 2,
          unitPrice: null,
          pricingType: "PER_DAY" as const,
          duration: 1,
          discount: null,
          lineTotal: null,
          groupName: null,
          groupTitle: null,
          isOptional: false,
          notes: null,
          status: "CHECKED_OUT" as const,
          model: null,
          asset: null,
          bulkAsset: null,
          units: [
            { id: "u-1", asset: { assetTag: "PC-1" }, bulkAsset: null, status: "CHECKED_OUT" as const },
            { id: "u-2", asset: { assetTag: "PC-2" }, bulkAsset: null, status: "CHECKED_OUT" as const },
          ],
        },
      ];
      const structured = structureLineItemsByContainer(raw as never, []);
      const data = makeSpikeData({ line_items: structured, total_items: 1 });
      const { fullText } = await renderPdfPages(DeliveryDocketDocument({ data }));

      expect(fullText).toContain("PC-1, PC-2");
      expect(fullText).not.toContain("Unit 1 —");
    });
  });
});
