/**
 * Types for the pdfme document generation system.
 */

export interface PdfBranding {
  primaryColor?: string;
  accentColor?: string;
  documentColor?: string;
  logoUrl?: string;
  iconUrl?: string;
  documentLogoMode?: "logo" | "icon" | "none";
  showOrgNameOnDocuments?: boolean;
}

export type DocumentType =
  | "quote"
  | "invoice"
  | "packing-list"
  | "return-sheet"
  | "delivery-docket"
  | "call-sheet";

export type TestTagReportType =
  | "tt-register"
  | "tt-overdue"
  | "tt-session"
  | "tt-item-history"
  | "tt-due-schedule"
  | "tt-class-summary"
  | "tt-tester-activity"
  | "tt-failed-items"
  | "tt-bulk-summary"
  | "tt-compliance-cert";

/** Line item structure passed to plugins (post-serialization, post-enrichment) */
export interface DocumentLineItem {
  id: string;
  description: string | null;
  quantity: number;
  checkedOutQuantity: number;
  unitPrice: number | null;
  pricingType: string;
  duration: number;
  discount: number | null;
  lineTotal: number | null;
  priceBreakdown?: string | null;
  priceOverridden?: boolean;
  groupName: string | null;
  categoryName: string | null;
  groupTitle: string | null;
  /**
   * The physical location (warehouse area, rack, shelf) the line item's
   * gear lives at, derived from the asset / bulk asset record. Null for
   * custom items, services, and unassigned bulk requests. Used by
   * `structureLineItems` to order rows in packer-walk order on
   * warehouse-facing docs. Display rendering is unchanged.
   */
  locationName?: string | null;
  /** True for synthetic rows representing a ProjectGroup (hides individual equipment) */
  isGroupRow?: boolean;
  isOptional: boolean;
  isKitChild?: boolean;
  /** KIT | ACCESSORY — distinguishes a kit member from an accessory child. */
  childKind?: "KIT" | "ACCESSORY" | null;
  kitId?: string | null;
  pricingMode?: string | null;
  notes: string | null;
  status: string;
  assetId?: string | null;
  bulkAssetId?: string | null;
  // Overbooked flags
  isOverbooked?: boolean;
  overbookedInherited?: boolean;
  overbookedReducedOnly?: boolean;
  overbookedHasOverbooked?: boolean;
  overbookedHasReduced?: boolean;
  // Subhire — `isSubhire` removed (Wave 2); detect via `subHireId != null`.
  subHireId?: string | null;
  /**
   * Specific SubHireGroup the item belongs to (if any). Items with this
   * field set get pulled into a dedicated Sub-Hire section on warehouse
   * docs so packers see what's hired-in vs owned at a glance.
   */
  subHireGroupId?: string | null;
  showSubhireOnDocs?: boolean;
  supplierName?: string | null;
  // Container
  prepContainer?: string | null;
  isContainerLineItem?: boolean;
  // Relations
  model: {
    name: string;
    modelNumber?: string | null;
    weight?: number | null;
    category?: { name: string } | null;
  } | null;
  asset: { assetTag: string } | null;
  bulkAsset: { assetTag: string } | null;
  kit?: { assetTag: string; name: string } | null;
  /**
   * Per-physical-unit assignments under the fulfillment model. A line
   * with quantity > 1 that's been deployed has one unit per physical
   * thing; renderers prefer this list over the legacy `asset` field
   * when present so docs show every assigned tag, not just the first.
   */
  units?: Array<{
    id: string;
    asset: { assetTag: string } | null;
    bulkAsset: { assetTag: string } | null;
    status: string;
    /** For an ACCESSORY-line unit: the parent unit's asset it travels with —
     *  lets the docket nest each accessory under its specific parent unit. */
    parentUnitAssetId?: string | null;
  }>;
  childLineItems?: DocumentLineItem[];
}

export interface CrewEntry {
  name: string;
  role: string | null;
  phase: string | null;
  callTime: string | null;
  endTime: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: string;
  department: string | null;
  breakMinutes: number | null;
  shiftLocation: string | null;
  shiftNotes: string | null;
  isProjectManager: boolean;
}

/** Data for a single day in a multi-day call sheet */
export interface CallSheetDayData {
  date: string;
  dayLabel: string;
  phases: string[];
  crew: CrewEntry[];
}

/** The full data contract assembled for document generation */
export interface DocumentData {
  // Org
  org_name: string;
  org_email: string;
  org_phone: string;
  org_address: string;
  org_website: string;
  org_logo: string | null;
  org_icon: string | null;
  org_tax_rate: number;
  org_tax_label: string;
  org_branding: PdfBranding | undefined;
  org_document_color: string;

  // Project
  project_number: string;
  project_name: string;
  project_status: string;
  project_type: string;

  // Dates
  rental_start: string;
  rental_end: string;
  event_start: string;
  event_end: string;
  load_in_date: string;
  load_out_date: string;

  // Client
  client_name: string;
  client_contact: string;
  client_email: string;
  client_phone: string;
  client_billing_address: string;
  client_tax_id: string;
  client_payment_terms: string;

  // Location
  venue_name: string;
  venue_address: string;
  site_contact_name: string;
  site_contact_phone: string;
  site_contact_email: string;

  // Financial
  subtotal: number;
  discount_percent: number;
  discount_amount: number;
  tax_label: string;
  tax_amount: number;
  total: number;
  deposit_paid: number;
  balance_due: number;

  // Notes
  client_notes: string;
  crew_notes: string;
  internal_notes: string;

  // Metadata
  document_date: string;
  /** Org-level document settings (src/lib/org-settings-types.ts `documents`).
   *  footer_text/footer_second_line: empty string = composer auto-generates
   *  from org_name/org_email/org_phone. */
  document_footer_text: string;
  document_footer_second_line: string;
  /** Quote-only: plain-text T&Cs block and a real computed "valid until" date
   *  (generatedAt + org's quoteValidityDays, default 30). */
  quote_terms_and_conditions: string;
  quote_valid_until: string;

  // PM
  pm_name: string;
  pm_phone: string;
  pm_email: string;

  // Schedule
  load_in_time: string;
  load_out_time: string;

  // Complex data (JSON-stringified for plugins)
  line_items: DocumentLineItem[];
  crew: CrewEntry[];
  crew_by_day: CallSheetDayData[];
  equipment_summary: string;

  // Computed
  total_items: number;
  total_weight: number;
}

/** Config for the gearflowTable plugin */
export interface TablePluginConfig {
  documentType: DocumentType;
  documentColor: string;
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
  filterOptional: boolean;
  filterByStatus: string[] | null;
  /** Suppress the "/day" (or other period) price suffix — quote layout only (#790 Phase 4). */
  hidePricingPeriodSuffix: boolean;
}

/** Config for financial summary plugin */
export interface FinancialSummaryConfig {
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  taxLabel: string;
  taxAmount: number;
  total: number;
  depositPaid: number;
  balanceDue: number;
  documentColor: string;
}

/** Config for the page header plugin */
export interface PageHeaderConfig {
  orgName: string;
  orgDetails: string;
  docTitle: string;
  docMeta: string;
  logoData: string | null;
  iconData: string | null;
  documentLogoMode: "logo" | "icon" | "none";
  showOrgNameOnDocuments: boolean;
  documentColor: string;
}

/** Config for signature line plugin */
export interface SignatureLineConfig {
  columns: { label: string; subLabel?: string }[];
  orgName?: string;
}

/** Config for footer plugin */
export interface FooterConfig {
  text: string;
  secondLine?: string;
  /** Page number text, e.g. "Page 1 of 4" — rendered right-aligned */
  pageNumber?: string;
}
