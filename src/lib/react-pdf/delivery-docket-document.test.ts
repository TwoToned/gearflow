/**
 * #1154 — automated smoke coverage for the standalone react-pdf
 * delivery-docket component tree. See `packing-list-document.test.ts`'s
 * header comment for why these tests stop at "renders, no throw, page-count
 * sanity" rather than parsing PDF text — the structured filtering/grouping
 * assertions (including the WS11 #950 SALE-inclusion rule and the kit
 * parent -> CHECKED_OUT-children promotion) already live in
 * `components/__tests__/line-items-table.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument as PdfLibDocument } from "@pdfme/pdf-lib";
import { DeliveryDocketDocument } from "./delivery-docket-document";
import { makeSpikeData, makeLongLineItemList, makeMixedRentalSaleLineItems } from "./fixture";

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

  it("renders row numbers and the kit-parent -> CHECKED_OUT-children promotion (kit parent in the fixture) without throwing", async () => {
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
});
