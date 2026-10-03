/**
 * #1151 spike — automated smoke coverage for the standalone react-pdf quote
 * proof-of-concept. This is deliberately thin: the spike's actual
 * deliverable is the written findings doc
 * (docs/designs/react-pdf-migration-spike-findings.md), not production test
 * coverage — issue #2 (shared component library) is where a
 * document-composer.test.ts-equivalent regression harness belongs. These
 * tests exist so the spike keeps rendering (catches an accidental break
 * while iterating) and to record the empirically-observed page counts the
 * findings doc cites, so they don't silently drift from what the code
 * actually does.
 */
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument as PdfLibDocument } from "@pdfme/pdf-lib";
import { QuoteDocument } from "./quote-document";
import { makeSpikeData, makeLongLineItemList } from "./fixture";

async function pageCount(data: ReturnType<typeof makeSpikeData>, draftPreview = false) {
  const buffer = await renderToBuffer(QuoteDocument({ data, draftPreview }));
  const pdf = await PdfLibDocument.load(buffer);
  return pdf.getPageCount();
}

describe("QuoteDocument (react-pdf spike)", () => {
  it("renders a single-page quote with no line items and no terms & conditions", async () => {
    const data = makeSpikeData({ line_items: [], total_items: 0, terms_and_conditions: "" });
    expect(await pageCount(data)).toBe(1);
  });

  it("paginates a long, varied line-item list across multiple pages with no throw", async () => {
    const items = makeLongLineItemList(60);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const pages = await pageCount(data);
    // Empirically 4 pages for this fixture (see render-spike.tsx). Asserting
    // a range rather than the exact count keeps this test from being
    // brittle against minor style/spacing tweaks while still catching a
    // gross pagination regression (e.g. everything collapsing to one page,
    // or the tail silently dropping and shrinking the count).
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

  it("reserves space for the draft-preview watermark and repeats it without dropping the table's tail", async () => {
    const items = makeLongLineItemList(60);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const withoutWatermark = await pageCount(data, false);
    const withWatermark = await pageCount(data, true);
    // The watermark takes vertical space on every page, so the same content
    // needs at least as many pages — never fewer (that would mean it
    // silently ate into the reserved content area and dropped a row, the
    // exact bug class #1151 is trying to structurally eliminate).
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
    // No throw is the real assertion here — the interesting part (that
    // isGroupRow/accessory-parent rows collapse to one row instead of
    // recursing into childLineItems) is visually verified in
    // render-spike.tsx's output; a DOM-less PDF byte stream doesn't expose
    // row structure cheaply enough to assert on directly in this harness.
    await expect(pageCount(data)).resolves.toBeGreaterThanOrEqual(1);
  });
});
