/**
 * #1156 (cutover) — the only call site for `@react-pdf/renderer`'s
 * render-producing exports (`renderToBuffer`/`renderToStream`/`renderToFile`/
 * `pdf`) in the app, mirroring `pdf-render.ts`'s role for `@pdfme/generator`
 * (POLICY.md R-8.10.1) — `no-restricted-imports` blocks importing those
 * named exports anywhere outside `src/lib/react-pdf/` (the vendor/library
 * layer: this file, the doc-type component trees, and their tests/dev
 * script all need direct access; `generate-pdf.ts` and every other app
 * call site route through here).
 *
 * `generate-pdf.ts`'s `generatePdf()` is the one caller — it used to build a
 * `composeDocument()` template and hand it to `renderPdfTemplate()`; now it
 * hands the already-built `DocumentData` straight to this function, which
 * just picks the matching component tree and lets react-pdf paginate.
 */
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import type { ProjectDocumentType } from "@/lib/pdfme/document-layouts";
import { QuoteDocument } from "./quote-document";
import { InvoiceDocument } from "./invoice-document";
import { PackingListDocument } from "./packing-list-document";
import { ReturnSheetDocument } from "./return-sheet-document";
import { DeliveryDocketDocument } from "./delivery-docket-document";

export interface RenderReactPdfOptions {
  /** Stamp the "DRAFT PREVIEW — NOT SENT" banner on every page. Quote/invoice
   *  only — see `document-layouts.ts`'s `DRAFT_PREVIEW_SUBTITLE` map. */
  draftPreview?: boolean;
}

export async function renderReactPdfTemplate(
  docType: ProjectDocumentType,
  data: DocumentData,
  options?: RenderReactPdfOptions,
): Promise<Uint8Array> {
  const draftPreview = options?.draftPreview ?? false;

  switch (docType) {
    case "quote":
      return renderToBuffer(<QuoteDocument data={data} draftPreview={draftPreview} />);
    case "invoice":
      return renderToBuffer(<InvoiceDocument data={data} draftPreview={draftPreview} />);
    case "packing-list":
      return renderToBuffer(<PackingListDocument data={data} />);
    case "return-sheet":
      return renderToBuffer(<ReturnSheetDocument data={data} />);
    case "delivery-docket":
      return renderToBuffer(<DeliveryDocketDocument data={data} />);
  }
}
