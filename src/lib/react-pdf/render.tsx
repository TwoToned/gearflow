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
import type { ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import type { ProjectDocumentType } from "@/lib/pdfme/document-layouts";
import { QuoteDocument } from "./quote-document";
import { InvoiceDocument } from "./invoice-document";
import { PackingListDocument } from "./packing-list-document";
import { ReturnSheetDocument } from "./return-sheet-document";
import { DeliveryDocketDocument } from "./delivery-docket-document";
import { ManifestDocument } from "./manifest-document";
import { ContainerLabelDocument } from "./container-label-document";

export interface RenderReactPdfOptions {
  /** Stamp the "DRAFT PREVIEW — NOT SENT" banner on every page. Quote/invoice
   *  only — see `document-layouts.ts`'s `DRAFT_PREVIEW_SUBTITLE` map. */
  draftPreview?: boolean;
  /** Container/kit labels only — print just this container id / kit line item id. */
  labelId?: string;
}

type Renderer = (data: DocumentData, options: { draftPreview: boolean; labelId?: string }) => ReactElement<DocumentProps>;

// A lookup (not a switch) keeps this function's branching flat as doc types grow.
const RENDERERS: Record<ProjectDocumentType, Renderer> = {
  quote: (data, o) => <QuoteDocument data={data} draftPreview={o.draftPreview} />,
  invoice: (data, o) => <InvoiceDocument data={data} draftPreview={o.draftPreview} />,
  "packing-list": (data) => <PackingListDocument data={data} />,
  "return-sheet": (data) => <ReturnSheetDocument data={data} />,
  "delivery-docket": (data) => <DeliveryDocketDocument data={data} />,
  manifest: (data) => <ManifestDocument data={data} />,
  "container-label": (data, o) => <ContainerLabelDocument data={data} kind="container" labelId={o.labelId} />,
  "kit-label": (data, o) => <ContainerLabelDocument data={data} kind="kit" labelId={o.labelId} />,
};

export async function renderReactPdfTemplate(
  docType: ProjectDocumentType,
  data: DocumentData,
  options?: RenderReactPdfOptions,
): Promise<Uint8Array> {
  return renderToBuffer(RENDERERS[docType](data, { draftPreview: options?.draftPreview ?? false, labelId: options?.labelId }));
}
