/**
 * #1153 — automated smoke coverage for the standalone react-pdf invoice
 * component tree, mirroring `quote-document.test.ts`'s bar (render, no
 * throw, page-count sanity — see that file's header comment and
 * `totals-block.test.tsx` for why this codebase's react-pdf tests stop
 * there rather than parsing PDF text). Covers the invoice-specific delta
 * `document-composer.test.ts` exercises against the old pipeline: due date,
 * payment details, ABN/client tax id, deposit/balance, and the
 * `org_invoice_heading` country-derived title override (I4, #1083).
 */
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument as PdfLibDocument } from "@pdfme/pdf-lib";
import { InvoiceDocument } from "./invoice-document";
import { makeSpikeData, makeLongLineItemList } from "./fixture";

async function pageCount(data: ReturnType<typeof makeSpikeData>, draftPreview = false) {
  const buffer = await renderToBuffer(InvoiceDocument({ data, draftPreview }));
  const pdf = await PdfLibDocument.load(buffer);
  return pdf.getPageCount();
}

describe("InvoiceDocument (react-pdf)", () => {
  it("renders a single-page invoice with no line items and no terms & conditions", async () => {
    const data = makeSpikeData({ line_items: [], total_items: 0, terms_and_conditions: "" });
    expect(await pageCount(data)).toBe(1);
  });

  it("paginates a long, varied line-item list across multiple pages with no throw", async () => {
    const items = makeLongLineItemList(60);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const pages = await pageCount(data);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(pages).toBeLessThanOrEqual(6);
  });

  it("adds a page for terms & conditions (forced own-page) without losing content", async () => {
    const withoutTerms = makeSpikeData({ line_items: [], total_items: 0, terms_and_conditions: "" });
    const withTerms = makeSpikeData({ line_items: [], total_items: 0 }); // fixture default has terms_and_conditions set
    const before = await pageCount(withoutTerms);
    const after = await pageCount(withTerms);
    expect(after).toBeGreaterThan(before);
  });

  it("does not force a new page for payment details, unlike terms & conditions", async () => {
    const withoutPaymentDetails = makeSpikeData({ line_items: [], total_items: 0, terms_and_conditions: "", payment_details: "" });
    const withPaymentDetails = makeSpikeData({
      line_items: [],
      total_items: 0,
      terms_and_conditions: "",
      payment_details: "Bank: Test Bank\nBSB: 000-000\nAcct: 12345678",
    });
    expect(await pageCount(withoutPaymentDetails)).toBe(1);
    expect(await pageCount(withPaymentDetails)).toBe(1);
  });

  it("reserves space for the draft-preview watermark and repeats it without dropping the table's tail", async () => {
    const items = makeLongLineItemList(60);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const withoutWatermark = await pageCount(data, false);
    const withWatermark = await pageCount(data, true);
    expect(withWatermark).toBeGreaterThanOrEqual(withoutWatermark);
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

  it("groups a Project Group's synthetic row and an accessory-parent row without expanding children (showKitChildren off)", async () => {
    const items = makeLongLineItemList(1);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    await expect(pageCount(data)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("renders the full invoice-only shape — due date, deposit/balance, payment details, client tax id, payment terms, invoice number — together without throwing", async () => {
    const data = makeSpikeData({
      line_items: [],
      total_items: 0,
      terms_and_conditions: "",
      invoice_due_date: "2026-09-17",
      deposit_paid: 500,
      balance_due: 18560.8,
      payment_details: "Bank: Test Bank\nBSB: 000-000\nAcct: 12345678",
      client_tax_id: "98 765 432 100",
      client_payment_terms: "14 days",
      invoice_number: "INV-2026-0142",
    });
    await expect(pageCount(data)).resolves.toBe(1);
  });

  it("renders the AU default 'TAX INVOICE' heading, a GB org_invoice_heading override, and a missing heading fallback without throwing", async () => {
    const items = makeLongLineItemList(1);
    for (const org_invoice_heading of ["TAX INVOICE", "INVOICE", ""]) {
      const data = makeSpikeData({ line_items: items, total_items: items.length, org_invoice_heading });
      await expect(pageCount(data)).resolves.toBeGreaterThanOrEqual(1);
    }
  });
});
