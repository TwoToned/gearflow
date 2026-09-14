/**
 * The 5 project document types and their doc-type-level flags.
 *
 * #1157 (cleanup) — this used to be the pdfme-composer pipeline's full
 * block-schema layout registry (`LayoutBlock`, `TableLayoutConfig`,
 * `getDocumentLayout`, the draft-watermark splice, etc.) that
 * `document-composer.ts` walked to paginate. #1156 cut the 5 project doc
 * types over to react-pdf, where each doc type is its own component tree
 * (`src/lib/react-pdf/*-document.tsx`) with its layout expressed directly in
 * JSX/config, not read from here — see FEATUREDOCS/13-pdfs.md. The only two
 * things still read from this module are `ProjectDocumentType` (the shared
 * doc-type union, used across the react-pdf trees, `generate-pdf.ts`, and the
 * API surface) and `DOCUMENT_LAYOUTS[docType].expandProjectGroups` (the one
 * layout flag `generate-pdf.ts` still needs before it knows which react-pdf
 * component to hand data to). The filename and export names are kept as-is to
 * avoid churning ~15 import sites for a rename.
 */
import type { DocumentType } from "./types";

/** The 5 project document types the react-pdf pipeline renders. Call sheets
 *  use their own service-based builder (`templates/call-sheet-services.ts`);
 *  T&T reports and the timeline use their own single-purpose builders. */
export type ProjectDocumentType = Exclude<DocumentType, "call-sheet">;

export interface DocumentLayout {
  /**
   * When true, Project Groups expand into a header row + each child line
   * item below (warehouse docs — packers need every serial). When false,
   * each Project Group collapses to a single virtual row (client-facing
   * docs). Packer sort order piggy-backs on this same flag.
   */
  expandProjectGroups: boolean;
}

export const DOCUMENT_LAYOUTS: Record<ProjectDocumentType, DocumentLayout> = {
  quote: { expandProjectGroups: false },
  invoice: { expandProjectGroups: false },
  "packing-list": { expandProjectGroups: true },
  "return-sheet": { expandProjectGroups: true },
  "delivery-docket": { expandProjectGroups: true },
};
