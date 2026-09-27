/**
 * #1154 — automated smoke coverage for the standalone react-pdf return-sheet
 * component tree. See `packing-list-document.test.ts`'s header comment for
 * why these tests stop at "renders, no throw, page-count sanity" rather than
 * parsing PDF text — the structured filtering/grouping assertions (including
 * the WS11 #950 SALE-exclusion rule) already live in
 * `components/__tests__/line-items-table.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument as PdfLibDocument } from "@pdfme/pdf-lib";
import { ReturnSheetDocument } from "./return-sheet-document";
import { makeSpikeData, makeLongLineItemList, makeMixedRentalSaleLineItems } from "./fixture";
import { structureLineItemsByContainer, type ContainerForStructuring } from "@/lib/pdfme/structure-line-items-by-container";
import { renderPdfPages } from "./pdf-test-utils";

async function pageCount(data: ReturnType<typeof makeSpikeData>) {
  const buffer = await renderToBuffer(ReturnSheetDocument({ data }));
  const pdf = await PdfLibDocument.load(buffer);
  return pdf.getPageCount();
}

describe("ReturnSheetDocument (react-pdf)", () => {
  it("renders a single-page return sheet with no line items", async () => {
    const data = makeSpikeData({ line_items: [], total_items: 0 });
    expect(await pageCount(data)).toBe(1);
  });

  it(
    "paginates a long, varied line-item list (filtered to CHECKED_OUT/RETURNED) across multiple pages with no throw",
    async () => {
      const items = makeLongLineItemList(60);
      const data = makeSpikeData({ line_items: items, total_items: items.length });
      const pages = await pageCount(data);
      expect(pages).toBeGreaterThanOrEqual(1);
    },
    // 15s, not the 5s default — see the identical comment/timeout on
    // src/lib/react-pdf/regression.test.tsx (PR #1210): rendering 60
    // multi-page items is CPU-heavy enough to tip over the default budget
    // under CI runner variance alone, with no code-path change involved.
    15_000,
  );

  it("renders condition columns (Good/Dmg/Missing) and per-unit checkboxes without throwing", async () => {
    const items = makeLongLineItemList(1);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    await expect(pageCount(data)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("renders the mixed rental + SALE fixture (WS11 #950) without throwing — SALE lines are excluded entirely on this doc type", async () => {
    const items = makeMixedRentalSaleLineItems();
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    await expect(pageCount(data)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("renders the signature block (Returned By / Received By / Date) without throwing, even with no line items", async () => {
    const data = makeSpikeData({ line_items: [], total_items: 0 });
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

  describe("container structuring (#1296 build plan phase 3c, D10)", () => {
    it("groups by the container gear left in, with a 'Case returned' box on the top-level container only", async () => {
      const containers: ContainerForStructuring[] = [{ id: "c1", kind: "CUSTOM", label: "Case 12", sortOrder: 0 }];
      const raw = [
        {
          id: "a", description: "Par Can", categoryName: "Lighting",
          quantity: 1, checkedOutQuantity: 1, unitPrice: null, pricingType: "PER_DAY" as const, duration: 1,
          discount: null, lineTotal: null, groupName: null, groupTitle: null,
          isOptional: false, notes: null, status: "RETURNED" as const, model: null, asset: null, bulkAsset: null,
          units: [{ id: "u-a", asset: { assetTag: "PC-1" }, bulkAsset: null, status: "RETURNED" as const, containerId: "c1" }],
        },
      ];
      const structured = structureLineItemsByContainer(raw as never, containers);
      const data = makeSpikeData({ line_items: structured, total_items: 1 });
      const { fullText } = await renderPdfPages(ReturnSheetDocument({ data }));

      expect(fullText).toContain("Case 12");
      expect(fullText).toContain("Case returned");
      expect(fullText).toContain("Par Can");
    });
  });
});
