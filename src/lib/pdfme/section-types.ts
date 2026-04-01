/**
 * Section types for the section-based template builder.
 * A template is an ordered list of typed sections, each with its own settings,
 * visibility rules, and optional content.
 */
import type { DocumentType } from "./types";

// ─── Section Types ───────────────────────────────────────────────────────────

export const SECTION_TYPES = [
  "header",
  "client-details",
  "project-details",
  "table",
  "totals",
  "notes",
  "signature",
  "custom-text",
  "crew-table",
  "call-sheet-info",
  "day-header",
  "spacer",
  "page-break",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

/** Human-readable labels for each section type */
export const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  header: "Header",
  "client-details": "Client Details",
  "project-details": "Project Details",
  table: "Equipment Table",
  totals: "Financial Totals",
  notes: "Notes",
  signature: "Signature Block",
  "custom-text": "Custom Text",
  "crew-table": "Crew Table",
  "call-sheet-info": "Call Sheet Info",
  "day-header": "Day Header",
  spacer: "Spacer",
  "page-break": "Page Break",
};

/** Short descriptions for the section library */
export const SECTION_TYPE_DESCRIPTIONS: Record<SectionType, string> = {
  header: "Organisation logo, name, and document title",
  "client-details": "Client name, contact, email, and address",
  "project-details": "Project name, dates, venue, and reference number",
  table: "Equipment line items with configurable columns",
  totals: "Subtotal, discount, tax, and total",
  notes: "Client notes or custom text",
  signature: "Signature lines with configurable columns",
  "custom-text": "Free text block with {token} support",
  "crew-table": "Crew assignments sorted by call time",
  "call-sheet-info": "PM contact, venue, schedule, and equipment summary",
  "day-header": "Day separator with date, phases, and crew count",
  spacer: "Vertical spacing between sections",
  "page-break": "Force a page break at this point",
};

// ─── Visibility Conditions ───────────────────────────────────────────────────

export type ConditionOperator = "exists" | "not_exists" | "equals" | "not_equals";

export interface VisibilityCondition {
  field: string; // e.g. "client_payment_terms", "venue_name"
  operator: ConditionOperator;
  value?: string; // required for equals/not_equals
}

export interface SectionVisibility {
  /** Only show for these document types. Null/empty = show for all. */
  docTypes?: DocumentType[];
  /** Only show when this data condition is met. Null = always show. */
  condition?: VisibilityCondition;
}

// ─── Section Settings (per-type) ─────────────────────────────────────────────

/** Common styling options available on most section types */
export interface SectionStyling {
  fontSize?: number; // 6-18, overrides default
  textColor?: string; // hex color, overrides default
}

/** A custom key-value field using tokens for dynamic values */
export interface CustomField {
  label: string; // e.g. "Bank", "ABN", "Payment Reference"
  value: string; // can use {tokens} e.g. "{org_name}" or plain text "BSB: 000-000"
}

export interface HeaderSectionSettings {
  logoMode: "logo" | "icon" | "none";
  showOrgName: boolean;
  showOrgAddress: boolean;
  showOrgPhone: boolean;
  showOrgEmail: boolean;
  showOrgWebsite: boolean;
  documentTitle: string; // supports {tokens}
}

export interface ClientDetailsSectionSettings {
  showClientName: boolean;
  showClientContact: boolean;
  showClientEmail: boolean;
  showClientAddress: boolean;
  showClientTaxId: boolean;
  /** Custom labels — override default field labels (e.g. "Customer" instead of "Client") */
  customLabels?: Record<string, string>;
  /** Additional key-value fields rendered after the built-in fields */
  customFields?: CustomField[];
  /** Per-section styling */
  styling?: SectionStyling;
}

export interface ProjectDetailsSectionSettings {
  showProjectName: boolean;
  showProjectNumber: boolean;
  showVenue: boolean;
  showRentalDates: boolean;
  showEventDates: boolean;
  showPaymentTerms: boolean;
  showSiteContact: boolean;
  showDocumentDate: boolean;
  /** Custom labels — override default field labels */
  customLabels?: Record<string, string>;
  /** Additional key-value fields rendered after the built-in fields */
  customFields?: CustomField[];
  /** Per-section styling */
  styling?: SectionStyling;
}

export interface TableSectionSettings {
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
}

export interface TotalsSectionSettings {
  showSubtotal: boolean;
  showDiscount: boolean;
  showTax: boolean;
  showTotal: boolean;
  showDeposit: boolean;
  showBalance: boolean;
}

export interface NotesSectionSettings {
  showClientNotes: boolean;
  showCrewNotes: boolean;
}

export interface SignatureSectionSettings {
  columns: number;
  labels: string[]; // e.g. ["Sent By", "Received By", "Date"]
}

export interface CustomTextSectionSettings {
  fontSize: number; // 7-14
  fontWeight: "normal" | "bold";
  alignment: "left" | "center" | "right";
}

export interface CrewTableSectionSettings {
  showPhone: boolean;
  showEmail: boolean;
  showNotes: boolean;
}

export interface CallSheetInfoSectionSettings {
  showPmContact: boolean;
  showClientContact: boolean;
  showVenueDetails: boolean;
  showScheduleTimes: boolean;
  showEquipmentSummary: boolean;
}

export interface DayHeaderSectionSettings {
  showPhases: boolean;
  showCrewCount: boolean;
}

export interface SpacerSectionSettings {
  height: number; // mm
}

/** Union type for all section settings */
export type SectionSettings =
  | HeaderSectionSettings
  | ClientDetailsSectionSettings
  | ProjectDetailsSectionSettings
  | TableSectionSettings
  | TotalsSectionSettings
  | NotesSectionSettings
  | SignatureSectionSettings
  | CustomTextSectionSettings
  | CrewTableSectionSettings
  | CallSheetInfoSectionSettings
  | DayHeaderSectionSettings
  | SpacerSectionSettings
  | Record<string, never>; // for page-break (no settings)

// ─── Template Section ────────────────────────────────────────────────────────

export interface TemplateSection {
  id: string;
  type: SectionType;
  settings: SectionSettings;
  visibility: SectionVisibility;
  /** Text content with {token} placeholders. Primary content for custom-text sections;
   *  appended as extra text for other section types. */
  content?: string;
  /** Sort position (0-based) */
  order: number;
  /** Layout metadata for column positioning (set when derived from blocks) */
  layoutHint?: LayoutHint;
}

// ─── Default Sections per Document Type ──────────────────────────────────────

/** Generate a unique section ID */
export function generateSectionId(): string {
  return `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Get default header settings */
export function getDefaultHeaderSettings(): HeaderSectionSettings {
  return {
    logoMode: "icon",
    showOrgName: true,
    showOrgAddress: true,
    showOrgPhone: true,
    showOrgEmail: true,
    showOrgWebsite: true,
    documentTitle: "",
  };
}

/** Get default client details settings */
export function getDefaultClientDetailsSettings(): ClientDetailsSectionSettings {
  return {
    showClientName: true,
    showClientContact: true,
    showClientEmail: true,
    showClientAddress: true,
    showClientTaxId: false,
  };
}

/** Get default project details settings */
export function getDefaultProjectDetailsSettings(): ProjectDetailsSectionSettings {
  return {
    showProjectName: true,
    showProjectNumber: true,
    showVenue: true,
    showRentalDates: true,
    showEventDates: true,
    showPaymentTerms: false,
    showSiteContact: false,
    showDocumentDate: true,
  };
}

/** Get default table settings */
export function getDefaultTableSettings(): TableSectionSettings {
  return {
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
}

/** Get default totals settings */
export function getDefaultTotalsSettings(): TotalsSectionSettings {
  return {
    showSubtotal: true,
    showDiscount: true,
    showTax: true,
    showTotal: true,
    showDeposit: false,
    showBalance: false,
  };
}

/** Get default notes settings */
export function getDefaultNotesSettings(): NotesSectionSettings {
  return {
    showClientNotes: true,
    showCrewNotes: false,
  };
}

/** Get default signature settings */
export function getDefaultSignatureSettings(): SignatureSectionSettings {
  return {
    columns: 2,
    labels: ["Sent By", "Received By"],
  };
}

/** Get default custom text settings */
export function getDefaultCustomTextSettings(): CustomTextSectionSettings {
  return {
    fontSize: 9,
    fontWeight: "normal",
    alignment: "left",
  };
}

/** Get default crew table settings */
export function getDefaultCrewTableSettings(): CrewTableSectionSettings {
  return {
    showPhone: true,
    showEmail: true,
    showNotes: true,
  };
}

/** Get default call sheet info settings */
export function getDefaultCallSheetInfoSettings(): CallSheetInfoSectionSettings {
  return {
    showPmContact: true,
    showClientContact: true,
    showVenueDetails: true,
    showScheduleTimes: true,
    showEquipmentSummary: true,
  };
}

/** Get default day header settings */
export function getDefaultDayHeaderSettings(): DayHeaderSectionSettings {
  return {
    showPhases: true,
    showCrewCount: true,
  };
}

/**
 * Get default section list for a document type.
 * Maps to the same layout the current hardcoded templates produce.
 */
export function getDefaultSections(docType: DocumentType): TemplateSection[] {
  const s = (type: SectionType, settings: SectionSettings, extra?: Partial<TemplateSection>): TemplateSection => ({
    id: generateSectionId(),
    type,
    settings,
    visibility: {},
    ...extra,
    order: 0, // will be set below
  });

  let sections: TemplateSection[];

  switch (docType) {
    case "quote":
      sections = [
        s("header", { ...getDefaultHeaderSettings(), documentTitle: "QUOTE" }),
        s("client-details", getDefaultClientDetailsSettings()),
        s("project-details", getDefaultProjectDetailsSettings()),
        s("table", getDefaultTableSettings()),
        s("totals", getDefaultTotalsSettings()),
        s("notes", getDefaultNotesSettings()),
        s("custom-text", getDefaultCustomTextSettings(), {
          content: "This quote is valid for 30 days from the date of issue.",
        }),
      ];
      break;

    case "invoice":
      sections = [
        s("header", { ...getDefaultHeaderSettings(), documentTitle: "TAX INVOICE" }),
        s("client-details", { ...getDefaultClientDetailsSettings(), showClientTaxId: true }),
        s("project-details", { ...getDefaultProjectDetailsSettings(), showPaymentTerms: true }),
        s("table", { ...getDefaultTableSettings(), showBadges: false }),
        s("totals", { ...getDefaultTotalsSettings(), showDeposit: true, showBalance: true }),
        s("notes", getDefaultNotesSettings()),
      ];
      break;

    case "packing-list":
      sections = [
        s("header", { ...getDefaultHeaderSettings(), documentTitle: "PULL SLIP" }),
        s("client-details", getDefaultClientDetailsSettings()),
        s("project-details", getDefaultProjectDetailsSettings()),
        s("table", {
          ...getDefaultTableSettings(),
          showCheckboxes: true,
          showPerUnitCheckboxes: true,
          showAssetTags: true,
          showCategories: true,
          showPricing: false,
          showBadges: false,
          showNotes: false,
        }),
        s("custom-text", { ...getDefaultCustomTextSettings(), fontSize: 8 }, {
          content: "Total items: {total_items}",
        }),
      ];
      break;

    case "return-sheet":
      sections = [
        s("header", { ...getDefaultHeaderSettings(), documentTitle: "RETURN SHEET" }),
        s("client-details", getDefaultClientDetailsSettings()),
        s("project-details", getDefaultProjectDetailsSettings()),
        s("table", {
          ...getDefaultTableSettings(),
          showCheckboxes: true,
          showConditionColumns: true,
          showPerUnitCheckboxes: true,
          showAssetTags: true,
          showPricing: false,
          showBadges: false,
          showNotes: false,
        }),
        s("signature", { columns: 3, labels: ["Returned By", "Received By", "Date"] }),
      ];
      break;

    case "delivery-docket":
      sections = [
        s("header", { ...getDefaultHeaderSettings(), documentTitle: "DELIVERY DOCKET" }),
        s("client-details", getDefaultClientDetailsSettings()),
        s("project-details", { ...getDefaultProjectDetailsSettings(), showSiteContact: true }),
        s("table", {
          ...getDefaultTableSettings(),
          showCheckboxes: true,
          showRowNumbers: true,
          showAssetTags: true,
          showPricing: false,
          showBadges: false,
          showNotes: false,
        }),
        s("signature", { columns: 3, labels: ["Delivered By", "Received By", "Date"] }),
      ];
      break;

    case "call-sheet":
      sections = [
        s("header", { ...getDefaultHeaderSettings(), documentTitle: "CALL SHEET" }),
        s("call-sheet-info", getDefaultCallSheetInfoSettings()),
        s("crew-table", getDefaultCrewTableSettings()),
        s("notes", { showClientNotes: false, showCrewNotes: true }),
      ];
      break;

    default: {
      const _exhaustive: never = docType;
      sections = [
        s("header", { ...getDefaultHeaderSettings(), documentTitle: String(_exhaustive).toUpperCase() }),
        s("table", getDefaultTableSettings()),
      ];
    }
  }

  // Set order indices
  return sections.map((sec, i) => ({ ...sec, order: i }));
}

// ─── Estimated Heights (mm) for page break calculations ──────────────────────

/** Estimated section heights in mm (for page break preview) */
export const SECTION_HEIGHT_ESTIMATES: Record<SectionType, number> = {
  header: 30,
  "client-details": 20,
  "project-details": 20,
  table: 0, // Dynamic — depends on item count
  totals: 25,
  notes: 15,
  signature: 20,
  "custom-text": 15,
  "crew-table": 0, // Dynamic — depends on crew count
  "call-sheet-info": 35,
  "day-header": 14,
  spacer: 10, // default, actual from settings
  "page-break": 0,
};

/** Estimate height per table row (mm) */
export const TABLE_ROW_HEIGHT_MM = 5;

/** Estimate height per crew row (mm) */
export const CREW_ROW_HEIGHT_MM = 5;

/** A4 content area height (297 - 14*2 margins) */
export const PAGE_CONTENT_HEIGHT_MM = 269;

/** Header/footer repeated on continuation pages (mm) */
export const CONTINUATION_OVERHEAD_MM = 20;

// ─── Block Editor Data Model ─────────────────────────────────────────────────

/** Per-section styling for PDF rendering (backgrounds, borders, padding) */
export interface BlockStyling {
  backgroundColor?: string; // hex color
  borderColor?: string; // hex color
  borderWidth?: number; // pt
  padding?: number; // mm
  margin?: number; // mm
}

/**
 * Layout hint attached to flat TemplateSection[] when derived from blocks.
 * Tells the renderer how to position this section within a column layout.
 */
export interface LayoutHint {
  /** Which row this section belongs to */
  rowId: string;
  /** 0-based column index within the row */
  columnIndex: number;
  /** Width of this column as a percentage (0-100) */
  columnWidth: number;
  /** Total number of columns in this row */
  columnCount: number;
  /** Optional styling for this section's block */
  styling?: BlockStyling;
}

// ─── Document-Level Settings ─────────────────────────────────────────────────

/** Settings for the page footer (repeated on every page) */
export interface FooterSettings {
  show: boolean;
  text: string;
  secondaryText: string;
  showPageNumbers: boolean;
  pageNumberFormat: "Page {page} of {pages}" | "{page} / {pages}" | "{page}";
}

/** Document-level settings stored alongside the template */
export interface DocumentTemplateSettings {
  footer: FooterSettings;
}

export function getDefaultFooterSettings(): FooterSettings {
  return {
    show: true,
    text: "{org_name} | {org_email} | {org_phone}",
    secondaryText: "",
    showPageNumbers: true,
    pageNumberFormat: "Page {page} of {pages}",
  };
}

export function getDefaultDocumentSettings(): DocumentTemplateSettings {
  return {
    footer: getDefaultFooterSettings(),
  };
}

/**
 * Block tree node for the editor. 2 levels deep:
 * - Row blocks contain column children
 * - Column blocks contain content (section) children
 * - Content blocks are leaf nodes with a SectionType
 */
export interface TemplateBlock {
  id: string;
  type: "row" | "column" | SectionType;
  /** Child blocks (rows have columns, columns have content) */
  children?: TemplateBlock[];
  /** Section settings (content blocks only) */
  settings?: SectionSettings;
  /** Visibility rules (content blocks only) */
  visibility?: SectionVisibility;
  /** Text content with {token} placeholders */
  content?: string;
  /** Column width percentages for row blocks, e.g. [50, 50] or [30, 70] */
  columnWidths?: number[];
  /** Per-section styling (background, border, padding) */
  styling?: BlockStyling;
}
