/**
 * #1156 (cutover) — proves `generatePdf()`'s wiring: it builds `DocumentData`
 * the same way it always did, then hands off to the react-pdf adapter
 * (`renderReactPdfTemplate`) instead of `composeDocument()` +
 * `renderPdfTemplate()`. `buildDocumentData` and the adapter are mocked —
 * their own correctness is covered elsewhere (`build-document-data.ts`'s
 * consumers, `src/lib/react-pdf/render.test.tsx`); this file only asserts
 * `generatePdf()` connects them correctly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const buildDocumentData = vi.fn();
vi.mock("./build-document-data", () => ({ buildDocumentData: (...a: unknown[]) => buildDocumentData(...a) }));

const renderReactPdfTemplate = vi.fn();
vi.mock("@/lib/react-pdf/render", () => ({ renderReactPdfTemplate: (...a: unknown[]) => renderReactPdfTemplate(...a) }));

import { generatePdf } from "./generate-pdf";

describe("generatePdf (react-pdf cutover wiring)", () => {
  beforeEach(() => {
    buildDocumentData.mockReset();
    renderReactPdfTemplate.mockReset();
  });

  it("builds document data with the doc type's expandProjectGroups and hands off to the react-pdf adapter", async () => {
    const data = { line_items: [] };
    buildDocumentData.mockResolvedValue(data);
    renderReactPdfTemplate.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const result = await generatePdf("p1", "org_1", "packing-list");

    expect(buildDocumentData).toHaveBeenCalledWith(
      "p1",
      "org_1",
      "packing-list",
      undefined,
      expect.objectContaining({ expandProjectGroups: true }), // packing-list expands groups
    );
    expect(renderReactPdfTemplate).toHaveBeenCalledWith("packing-list", data, { draftPreview: undefined });
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("threads stampedDates/versionSuffix/invoiceId through to buildDocumentData", async () => {
    buildDocumentData.mockResolvedValue({});
    renderReactPdfTemplate.mockResolvedValue(new Uint8Array());

    await generatePdf("p2", "org_2", "invoice", {
      stampedDates: { documentDate: 123 },
      versionSuffix: "-v2",
      invoiceId: "inv_1",
    });

    expect(buildDocumentData).toHaveBeenCalledWith(
      "p2",
      "org_2",
      "invoice",
      undefined,
      expect.objectContaining({
        expandProjectGroups: false, // invoice collapses groups (client-facing)
        stampedDates: { documentDate: 123 },
        versionSuffix: "-v2",
        invoiceId: "inv_1",
      }),
    );
  });

  it("threads draftPreview through to the react-pdf adapter", async () => {
    const data = {};
    buildDocumentData.mockResolvedValue(data);
    renderReactPdfTemplate.mockResolvedValue(new Uint8Array());

    await generatePdf("p3", "org_3", "quote", { draftPreview: true });

    expect(renderReactPdfTemplate).toHaveBeenCalledWith("quote", data, { draftPreview: true });
  });
});
