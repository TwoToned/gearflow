/**
 * Fixed, hardcoded layouts for the 5 project document types. Each layout is an
 * ordered list of blocks — no visibility conditions, no {token} text, no
 * per-org customisation. This is the single source of truth for what a
 * document looks like; `document-composer.ts` walks it and paginates.
 *
 * Values mirror the pre-redesign section-based defaults (the parity target —
 * see docs/designs/pdf-system-redesign.md), demoted from persisted JSON to
 * plain code.
 */
import type { DocumentType } from "./types";

export interface ClientDetailsConfig {
  showClientName: boolean;
  showClientContact: boolean;
  showClientEmail: boolean;
  showClientAddress: boolean;
  showClientTaxId: boolean;
}

export interface ProjectDetailsConfig {
  showVenue: boolean;
  showRentalDates: boolean;
  showEventDates: boolean;
  showPaymentTerms: boolean;
  showSiteContact: boolean;
  showDocumentDate: boolean;
  /** WS1 (#940) — the ISSUED invoice number (invoice doc type only; empty
   *  string / not-yet-issued renders nothing, never "undefined"). */
  showInvoiceNumber?: boolean;
}

export interface TableLayoutConfig {
  showGroupHeaders: boolean;
  showKitChildren: boolean;
  showCheckboxes: boolean;
  showConditionColumns: boolean;
  showPricing: boolean;
  showBadges: boolean;
  showNotes: boolean;
  showPerUnitCheckboxes: boolean;
  showAssetTags: boolean;
  showCategories: boolean;
  showRowNumbers: boolean;
  /** Suppress the "/day" (or other period) price suffix. Quote-only (#790 Phase 4). */
  hidePricingPeriodSuffix?: boolean;
}

export interface TotalsLayoutConfig {
  showSubtotal: boolean;
  showDiscount: boolean;
  showTax: boolean;
  showTotal: boolean;
  showDeposit: boolean;
  showBalance: boolean;
  /** Bold "Due Date" row at the bottom of the totals block. Invoice only —
   *  makes the due date impossible to miss right where the client is
   *  already looking for the amount owed. */
  showDueDate: boolean;
}

export type LayoutBlock =
  | { kind: "header"; title: string }
  /**
   * "DRAFT PREVIEW — NOT SENT" banner (#987). Never part of a stored layout —
   * `getDocumentLayout(docType, { draftPreview: true })` splices it in for the
   * preview render only, and `document-composer.ts` repeats it under the header
   * on EVERY page (a banner on page 1 of a 4-page quote is not a warning).
   */
  | { kind: "draftWatermark"; title: string; subtitle: string }
  | { kind: "detailsRow"; client: ClientDetailsConfig; project: ProjectDetailsConfig }
  | { kind: "table"; config: TableLayoutConfig }
  | { kind: "totals"; config: TotalsLayoutConfig }
  | { kind: "clientNotes" }
  | { kind: "totalItemsNote" }
  /** `forceNewPage`: always starts on a fresh page rather than sharing
   *  whatever room is left on the page above it — the legal boilerplate
   *  reads as its own section, not a tacked-on tail. */
  | { kind: "termsAndConditions"; forceNewPage?: boolean }
  /**
   * Bank/payment details block (invoice only) — org-authored plain text,
   * same free-text/markdown-lite convention as `termsAndConditions`. Unlike
   * T&Cs it never forces a new page: it's meant to land on the same page as
   * the totals block it's placed directly after, not read as a separate
   * legal section.
   */
  | { kind: "paymentDetails" }
  | { kind: "signature"; columns: number; labels: string[] };

export interface DocumentLayout {
  blocks: LayoutBlock[];
  /**
   * When true, Project Groups expand into a header row + each child line
   * item below (warehouse docs — packers need every serial). When false,
   * each Project Group collapses to a single virtual row (client-facing
   * docs). Packer sort order piggy-backs on this same flag.
   */
  expandProjectGroups: boolean;
  /** Status filter applied to line items before rendering, or null for none. */
  filterByStatus: string[] | null;
}

const defaultClientDetails: ClientDetailsConfig = {
  showClientName: true,
  showClientContact: true,
  showClientEmail: true,
  showClientAddress: true,
  showClientTaxId: false,
};

const defaultProjectDetails: ProjectDetailsConfig = {
  showVenue: true,
  showRentalDates: true,
  showEventDates: true,
  showPaymentTerms: false,
  showSiteContact: false,
  // The document date already appears in the header meta (next to the doc
  // number) on every doc type — repeating it in the details block was
  // redundant.
  showDocumentDate: false,
};

const defaultTable: TableLayoutConfig = {
  showGroupHeaders: true,
  showKitChildren: true,
  showCheckboxes: false,
  showConditionColumns: false,
  showPricing: true,
  showBadges: true,
  showNotes: true,
  showPerUnitCheckboxes: false,
  showAssetTags: false,
  showCategories: false,
  showRowNumbers: false,
};

const defaultTotals: TotalsLayoutConfig = {
  showSubtotal: true,
  showDiscount: true,
  showTax: true,
  showTotal: true,
  showDeposit: false,
  showBalance: false,
  showDueDate: false,
};

/** The 5 project document types the composer pipeline renders. Call sheets
 *  use their own service-based builder (`templates/call-sheet-services.ts`);
 *  T&T reports and the timeline use their own single-purpose builders. */
export type ProjectDocumentType = Exclude<DocumentType, "call-sheet">;

/**
 * Client-facing docs (quote, invoice) show top-level line items, groups, and
 * their descriptions/notes only — no exploded kit/accessory children (the
 * client doesn't need "AA Battery x4" under "Wireless Mic x2"), and no
 * internal warehouse badges like OVERBOOKED / REDUCED STOCK. Warehouse docs
 * (packing-list, return-sheet, delivery-docket) keep `defaultTable`'s
 * `showKitChildren: true` unchanged — packers still need every component.
 */
const clientFacingTable: TableLayoutConfig = {
  ...defaultTable,
  showBadges: false,
  showKitChildren: false,
};

export const DOCUMENT_LAYOUTS: Record<ProjectDocumentType, DocumentLayout> = {
  quote: {
    expandProjectGroups: false,
    filterByStatus: null,
    blocks: [
      { kind: "header", title: "QUOTE" },
      { kind: "detailsRow", client: defaultClientDetails, project: defaultProjectDetails },
      { kind: "table", config: { ...clientFacingTable, hidePricingPeriodSuffix: true } },
      { kind: "totals", config: defaultTotals },
      { kind: "clientNotes" },
      { kind: "termsAndConditions", forceNewPage: true },
    ],
  },

  invoice: {
    expandProjectGroups: false,
    filterByStatus: null,
    blocks: [
      { kind: "header", title: "TAX INVOICE" },
      {
        kind: "detailsRow",
        client: { ...defaultClientDetails, showClientTaxId: true },
        project: { ...defaultProjectDetails, showPaymentTerms: true, showInvoiceNumber: true },
      },
      { kind: "table", config: { ...clientFacingTable, hidePricingPeriodSuffix: true } },
      { kind: "totals", config: { ...defaultTotals, showDeposit: true, showBalance: true, showDueDate: true } },
      { kind: "paymentDetails" },
      { kind: "clientNotes" },
      { kind: "termsAndConditions", forceNewPage: true },
    ],
  },

  "packing-list": {
    expandProjectGroups: true,
    filterByStatus: null,
    blocks: [
      { kind: "header", title: "PULL SLIP" },
      { kind: "detailsRow", client: defaultClientDetails, project: defaultProjectDetails },
      {
        kind: "table",
        config: {
          ...defaultTable,
          showCheckboxes: true,
          showPerUnitCheckboxes: true,
          showAssetTags: true,
          showCategories: true,
          showPricing: false,
          showBadges: false,
          showNotes: false,
        },
      },
      { kind: "totalItemsNote" },
    ],
  },

  "return-sheet": {
    expandProjectGroups: true,
    filterByStatus: ["CHECKED_OUT", "RETURNED"],
    blocks: [
      { kind: "header", title: "RETURN SHEET" },
      { kind: "detailsRow", client: defaultClientDetails, project: defaultProjectDetails },
      {
        kind: "table",
        config: {
          ...defaultTable,
          showCheckboxes: true,
          showConditionColumns: true,
          showPerUnitCheckboxes: true,
          showAssetTags: true,
          showPricing: false,
          showBadges: false,
          showNotes: false,
        },
      },
      { kind: "signature", columns: 3, labels: ["Returned By", "Received By", "Date"] },
    ],
  },

  "delivery-docket": {
    expandProjectGroups: true,
    filterByStatus: ["CHECKED_OUT"],
    blocks: [
      { kind: "header", title: "DELIVERY DOCKET" },
      {
        kind: "detailsRow",
        client: defaultClientDetails,
        project: { ...defaultProjectDetails, showSiteContact: true },
      },
      {
        kind: "table",
        config: {
          ...defaultTable,
          showCheckboxes: true,
          showRowNumbers: true,
          showAssetTags: true,
          showPerUnitCheckboxes: true,
          showPricing: false,
          showBadges: false,
          showNotes: false,
        },
      },
      { kind: "signature", columns: 3, labels: ["Delivered By", "Received By", "Date"] },
    ],
  },
};

/** The banner text per doc type. One place, so the composer's height reservation
 *  and the plugin's render can never disagree about what is being drawn. */
const DRAFT_PREVIEW_TITLE = "DRAFT PREVIEW — NOT SENT";
const DRAFT_PREVIEW_SUBTITLE: Partial<Record<ProjectDocumentType, string>> = {
  quote: "Live pricing, not frozen — this is not the document the client holds. Send the quote to produce that.",
  invoice: "Live pricing, not frozen — this invoice has not been issued and has no invoice number.",
};

export interface DocumentLayoutOptions {
  /**
   * Stamp the draft-preview watermark (#987). Set ONLY by
   * `/api/documents/[projectId]?preview=1`; a stored artifact is rendered
   * without it, which is what makes "the file you downloaded is the file the
   * client got" checkable by eye as well as by byte.
   */
  draftPreview?: boolean;
}

export function getDocumentLayout(
  docType: ProjectDocumentType,
  options?: DocumentLayoutOptions,
): DocumentLayout {
  const layout = DOCUMENT_LAYOUTS[docType];
  if (!options?.draftPreview) return layout;

  const watermark: LayoutBlock = {
    kind: "draftWatermark",
    title: DRAFT_PREVIEW_TITLE,
    subtitle: DRAFT_PREVIEW_SUBTITLE[docType] ?? "This is a preview. It has not been sent to the client.",
  };
  // Directly after the header — the composer treats it as page furniture and
  // repeats both on every page, so ordering here only fixes which comes first.
  const headerIdx = layout.blocks.findIndex((b) => b.kind === "header");
  const blocks = [...layout.blocks];
  blocks.splice(headerIdx + 1, 0, watermark);
  return { ...layout, blocks };
}
