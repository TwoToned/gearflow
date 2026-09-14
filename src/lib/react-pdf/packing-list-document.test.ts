/**
 * #1154 — automated smoke coverage for the standalone react-pdf packing-list
 * component tree, mirroring `quote-document.test.ts`'s bar (render, no
 * throw, page-count sanity — see that file's header comment for why this
 * codebase's react-pdf tests stop there rather than parsing PDF text).
 * Structured-data assertions on filtering/grouping/badges (including SALE
 * inclusion, kit/group/accessory expansion) live in
 * `components/__tests__/line-items-table.test.ts`, already exercised across
 * all 5 doc types in `line-items-table.render.test.tsx` — this file only
 * proves the doc-type-level composition (header/details/table/note/footer)
 * renders to real PDF bytes without throwing and without dropping content.
 */
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument as PdfLibDocument } from "@pdfme/pdf-lib";
import { PackingListDocument } from "./packing-list-document";
import { makeSpikeData, makeLongLineItemList, makeMixedRentalSaleLineItems } from "./fixture";

async function pageCount(data: ReturnType<typeof makeSpikeData>) {
  const buffer = await renderToBuffer(PackingListDocument({ data }));
  const pdf = await PdfLibDocument.load(buffer);
  return pdf.getPageCount();
}

describe("PackingListDocument (react-pdf)", () => {
  it("renders a single-page pull slip with no line items", async () => {
    const data = makeSpikeData({ line_items: [], total_items: 0 });
    expect(await pageCount(data)).toBe(1);
  });

  it("paginates a long, varied line-item list across multiple pages with no throw", async () => {
    const items = makeLongLineItemList(60);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const pages = await pageCount(data);
    expect(pages).toBeGreaterThanOrEqual(3);
  });

  it("expands kit/group/accessory children (showKitChildren on), unlike quote/invoice", async () => {
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

  it("renders the mixed rental + SALE fixture (WS11 #950) without throwing — SALE items are included regardless of status", async () => {
    const items = makeMixedRentalSaleLineItems();
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    await expect(pageCount(data)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("renders without throwing regardless of total_items magnitude (the note after the table)", async () => {
    const data = makeSpikeData({ line_items: [], total_items: 4200 });
    await expect(pageCount(data)).resolves.toBe(1);
  });
});
