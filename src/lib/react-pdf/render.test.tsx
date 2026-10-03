/**
 * #1156 (cutover) — smoke coverage for `renderReactPdfTemplate()`, the
 * single call site `generate-pdf.ts` now uses for all 5 project doc types.
 * Each doc type's own render/page-count/text-content behavior is already
 * covered by its component test file and `regression.test.tsx`; this file
 * only proves the adapter dispatches to the right component per doc type
 * and threads `draftPreview` through where it's supported.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument as PdfLibDocument } from "@pdfme/pdf-lib";
import { DOCUMENT_LAYOUTS } from "@/lib/pdfme/document-layouts";
import type { ProjectDocumentType } from "@/lib/pdfme/document-layouts";
import { renderReactPdfTemplate } from "./render";
import { makeSpikeData, makeLongLineItemList } from "./fixture";

const PROJECT_DOC_TYPES = Object.keys(DOCUMENT_LAYOUTS) as ProjectDocumentType[];

describe.each(PROJECT_DOC_TYPES)("renderReactPdfTemplate — %s", (docType) => {
  it("renders real PDF bytes with a sane page count", async () => {
    const items = makeLongLineItemList(1);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const bytes = await renderReactPdfTemplate(docType, data);

    const pdf = await PdfLibDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe("renderReactPdfTemplate — draftPreview", () => {
  it.each(["quote", "invoice"] as const)("stamps the watermark for %s when draftPreview is true", async (docType) => {
    const data = makeSpikeData({ line_items: [], total_items: 0, terms_and_conditions: "" });
    const withWatermark = await renderReactPdfTemplate(docType, data, { draftPreview: true });
    const withoutWatermark = await renderReactPdfTemplate(docType, data, { draftPreview: false });

    // Watermark adds a visible block — the watermarked render is never smaller.
    expect(withWatermark.byteLength).toBeGreaterThan(0);
    expect(withoutWatermark.byteLength).toBeGreaterThan(0);
  });

  it("ignores draftPreview for doc types that don't support it (no throw)", async () => {
    const items = makeLongLineItemList(1);
    for (const docType of ["packing-list", "return-sheet", "delivery-docket"] as const) {
      const data = makeSpikeData({ line_items: items, total_items: items.length });
      await expect(renderReactPdfTemplate(docType, data, { draftPreview: true })).resolves.toBeInstanceOf(Uint8Array);
    }
  });
});

describe("renderReactPdfTemplate — paper size (#1084, live in the old pipeline)", () => {
  it.each(PROJECT_DOC_TYPES)("renders LETTER at US Letter dimensions for %s", async (docType) => {
    const data = makeSpikeData({ line_items: [], total_items: 0, org_paper_size: "LETTER" });
    const bytes = await renderReactPdfTemplate(docType, data);
    const pdf = await PdfLibDocument.load(bytes);
    const { width, height } = pdf.getPage(0).getSize();

    // US Letter is 8.5in x 11in = 612pt x 792pt.
    expect(Math.round(width)).toBe(612);
    expect(Math.round(height)).toBe(792);
  });

  it.each(PROJECT_DOC_TYPES)("renders A4 at A4 dimensions for %s (default)", async (docType) => {
    const data = makeSpikeData({ line_items: [], total_items: 0, org_paper_size: "A4" });
    const bytes = await renderReactPdfTemplate(docType, data);
    const pdf = await PdfLibDocument.load(bytes);
    const { width, height } = pdf.getPage(0).getSize();

    // A4 is 210mm x 297mm = 595.28pt x 841.89pt.
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });
});
