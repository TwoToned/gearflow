/**
 * TemplateSettings — user-facing configuration for document templates.
 * Stored as JSON in DocumentTemplate.settings column.
 * Template builders consume these settings to adjust their output.
 */
import type { DocumentType } from "./types";

export interface TemplateSettings {
  // ─── General ─────────────────────────────────
  accentColor: string; // hex color, defaults to org's documentColor

  // ─── Header ──────────────────────────────────
  header: {
    logoMode: "logo" | "icon" | "none";
    showOrgName: boolean;
    showOrgAddress: boolean;
    showOrgPhone: boolean;
    showOrgEmail: boolean;
    showOrgWebsite: boolean;
    documentTitle: string; // e.g. "QUOTE", "TAX INVOICE"
  };

  // ─── Footer ──────────────────────────────────
  footer: {
    showFooter: boolean;
    primaryText: string; // e.g. "{org_name} | {org_email} | {org_phone}"
    secondaryText: string; // e.g. "This quote is valid for 30 days..."
  };

  // ─── Document Details ─────────────────────────
  details: {
    // Client fields
    showClientName: boolean;
    showClientContact: boolean;
    showClientEmail: boolean;
    showClientAddress: boolean;
    showClientTaxId: boolean;
    // Project fields
    showProjectName: boolean;
    showProjectNumber: boolean;
    showVenue: boolean;
    showRentalDates: boolean;
    showEventDates: boolean;
    showPaymentTerms: boolean;
    showSiteContact: boolean;
    showDocumentDate: boolean;
  };

  // ─── Table ────────────────────────────────────
  table: {
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
    /**
     * When true, Project Groups expand into a header row + each child line
     * item below. When false, each Project Group collapses to a single
     * virtual line item row (the legacy quote/invoice behaviour). Warehouse
     * doc types default to true so packers see every item to pick.
     * Client-facing doc types (quote, invoice) default to false so the
     * client sees a clean "Lighting Package x1" row.
     */
    expandProjectGroups: boolean;
  };

  // ─── Totals ───────────────────────────────────
  totals: {
    showTotals: boolean;
    showSubtotal: boolean;
    showDiscount: boolean;
    showTax: boolean;
    showTotal: boolean;
    showDeposit: boolean;
    showBalance: boolean;
  };

  // ─── Other ────────────────────────────────────
  other: {
    showClientNotes: boolean;
    showCrewNotes: boolean;
    showSignatureSection: boolean;
    signatureColumns: number;
    showSummaryLine: boolean;
  };
}

/** Default document titles per type */
const DEFAULT_TITLES: Record<DocumentType, string> = {
  quote: "QUOTE",
  invoice: "TAX INVOICE",
  "packing-list": "PULL SLIP",
  "return-sheet": "RETURN SHEET",
  "delivery-docket": "DELIVERY DOCKET",
  "call-sheet": "CALL SHEET",
};

/** Default footer secondary text per type */
const DEFAULT_FOOTER_TEXT: Record<DocumentType, string> = {
  quote: "This quote is valid for 30 days from the date of issue.",
  invoice: "",
  "packing-list": "",
  "return-sheet": "",
  "delivery-docket": "",
  "call-sheet": "",
};

/**
 * Get default TemplateSettings for a document type.
 * Maps the existing hardcoded configs from each template builder.
 */
export function getDefaultSettings(docType: DocumentType): TemplateSettings {
  const base: TemplateSettings = {
    accentColor: "", // empty = use org's documentColor

    header: {
      logoMode: "icon",
      showOrgName: true,
      showOrgAddress: true,
      showOrgPhone: true,
      showOrgEmail: true,
      showOrgWebsite: true,
      documentTitle: DEFAULT_TITLES[docType],
    },

    footer: {
      showFooter: true,
      primaryText: "", // empty = auto-generate from org details
      secondaryText: DEFAULT_FOOTER_TEXT[docType],
    },

    details: {
      showClientName: true,
      showClientContact: true,
      showClientEmail: true,
      showClientAddress: true,
      showClientTaxId: false,
      showProjectName: true,
      showProjectNumber: true,
      showVenue: true,
      showRentalDates: true,
      showEventDates: true,
      showPaymentTerms: false,
      showSiteContact: false,
      showDocumentDate: true,
    },

    table: {
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
      // Client-facing default: collapse Project Groups into a single row
      // ("Lighting Package x1"). Overridden per docType below.
      expandProjectGroups: false,
    },

    totals: {
      showTotals: true,
      showSubtotal: true,
      showDiscount: true,
      showTax: true,
      showTotal: true,
      showDeposit: false,
      showBalance: false,
    },

    other: {
      showClientNotes: true,
      showCrewNotes: false,
      showSignatureSection: false,
      signatureColumns: 2,
      showSummaryLine: false,
    },
  };

  // Per-type overrides
  switch (docType) {
    case "quote":
      // Quote defaults are the base
      break;

    case "invoice":
      base.details.showClientTaxId = true;
      base.details.showPaymentTerms = true;
      base.table.showBadges = false;
      base.totals.showDeposit = true;
      base.totals.showBalance = true;
      break;

    case "packing-list":
      base.table.showCheckboxes = true;
      base.table.showPerUnitCheckboxes = true;
      base.table.showAssetTags = true;
      base.table.showCategories = true;
      base.table.showPricing = false;
      base.table.showBadges = false;
      base.table.showNotes = false;
      // Warehouse staff need to see every item to pick — never collapse.
      base.table.expandProjectGroups = true;
      base.totals.showTotals = false;
      base.other.showSummaryLine = true;
      base.other.showClientNotes = false;
      break;

    case "return-sheet":
      base.table.showCheckboxes = true;
      base.table.showConditionColumns = true;
      base.table.showPerUnitCheckboxes = true;
      base.table.showAssetTags = true;
      base.table.showPricing = false;
      base.table.showBadges = false;
      base.table.showNotes = false;
      // Same as packing list — receivers need item-level detail.
      base.table.expandProjectGroups = true;
      base.totals.showTotals = false;
      base.other.showSignatureSection = true;
      base.other.signatureColumns = 3;
      base.other.showClientNotes = false;
      break;

    case "delivery-docket":
      base.table.showCheckboxes = true;
      base.table.showRowNumbers = true;
      base.table.showAssetTags = true;
      // Per-unit sub-rows so a 10x line lists every assigned asset tag
      // for the client to tick off on receipt — the whole reason the
      // line-item fulfillment rework happened.
      base.table.showPerUnitCheckboxes = true;
      base.table.showPricing = false;
      base.table.showBadges = false;
      base.table.showNotes = false;
      // Per CEO premise D1: delivery docket expands groups with serials
      // so the signed handover doc has full evidence of what was delivered.
      base.table.expandProjectGroups = true;
      base.details.showSiteContact = true;
      base.totals.showTotals = false;
      base.other.showSignatureSection = true;
      base.other.signatureColumns = 3;
      base.other.showClientNotes = false;
      break;

    case "call-sheet":
      base.table.showPricing = false;
      base.totals.showTotals = false;
      base.other.showCrewNotes = true;
      base.other.showClientNotes = false;
      break;
  }

  return base;
}

/**
 * Resolve a template's settings against the docType defaults so legacy
 * stored JSON (which predates new settings keys like `expandProjectGroups`)
 * picks up safe defaults at read time. Per the engineering review's most
 * critical failure mode: without this, every existing org template would
 * silently regress to whatever `undefined` falls through to in the new
 * code path — which for `expandProjectGroups` is the pre-fix collapsed-row
 * bug.
 *
 * Stored values always win over defaults. Pass an object, a JSON string,
 * or `null` / `undefined` — the latter two yield the bare docType defaults.
 */
export function resolveTemplateSettings(
  docType: DocumentType,
  stored: Partial<TemplateSettings> | TemplateSettings | string | null | undefined,
): TemplateSettings {
  const defaults = getDefaultSettings(docType);
  if (!stored) return defaults;

  let parsed: Partial<TemplateSettings>;
  if (typeof stored === "string") {
    try {
      parsed = JSON.parse(stored) as Partial<TemplateSettings>;
    } catch {
      return defaults;
    }
  } else {
    parsed = stored;
  }

  return {
    ...defaults,
    ...parsed,
    header: { ...defaults.header, ...parsed.header },
    footer: { ...defaults.footer, ...parsed.footer },
    details: { ...defaults.details, ...parsed.details },
    table: { ...defaults.table, ...parsed.table },
    totals: { ...defaults.totals, ...parsed.totals },
    other: { ...defaults.other, ...parsed.other },
  };
}
