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
}

export type LayoutBlock =
  | { kind: "header"; title: string }
  | { kind: "detailsRow"; client: ClientDetailsConfig; project: ProjectDetailsConfig }
  | { kind: "table"; config: TableLayoutConfig }
  | { kind: "totals"; config: TotalsLayoutConfig }
  | { kind: "clientNotes" }
  | { kind: "totalItemsNote" }
  | { kind: "quoteValidityNote" }
  | { kind: "termsAndConditions" }
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
};

/** The 5 project document types the composer pipeline renders. Call sheets
 *  use their own service-based builder (`templates/call-sheet-services.ts`);
 *  T&T reports and the timeline use their own single-purpose builders. */
export type ProjectDocumentType = Exclude<DocumentType, "call-sheet">;

export const DOCUMENT_LAYOUTS: Record<ProjectDocumentType, DocumentLayout> = {
  quote: {
    expandProjectGroups: false,
    filterByStatus: null,
    blocks: [
      { kind: "header", title: "QUOTE" },
      { kind: "detailsRow", client: defaultClientDetails, project: defaultProjectDetails },
      { kind: "table", config: { ...defaultTable, hidePricingPeriodSuffix: true } },
      { kind: "totals", config: defaultTotals },
      { kind: "clientNotes" },
      { kind: "termsAndConditions" },
      { kind: "quoteValidityNote" },
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
      { kind: "table", config: { ...defaultTable, showBadges: false } },
      { kind: "totals", config: { ...defaultTotals, showDeposit: true, showBalance: true } },
      { kind: "clientNotes" },
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

export function getDocumentLayout(docType: ProjectDocumentType): DocumentLayout {
  return DOCUMENT_LAYOUTS[docType];
}
