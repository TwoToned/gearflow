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
  /**
   * #1012 — how the operator ENTERED `discount`: `"%"` off the line's gross, or
   * a flat `"$"` amount. `discount` itself is always the resolved dollar amount;
   * this only drives how the Discount column prints it. Absent/null (every row
   * written before #1012) renders as `"$"`, which is exactly the old behaviour.
   * The percentage shown is DERIVED from `discount` against the row's own gross
   * — see `src/lib/discount-mode.ts` for why it isn't stored.
   */
  discountMode?: "$" | "%" | null;
  lineTotal: number | null;
  priceBreakdown?: string | null;
  priceOverridden?: boolean;
  groupName: string | null;
  categoryName: string | null;
  groupTitle: string | null;
  /**
   * The Project Group's own id (FK — `projectLineItems.groupId`), when this
   * line belongs to one. `groupTitle`/`categoryName` are resolved display
   * strings that depend on the item's OWN `categoryId` also being set; a
   * group's members can have `groupId` set while their `categoryId` is
   * still null (e.g. the group itself lives in the equipment tab's
   * "Uncategorized" zone) — `groupId` is the one field guaranteed to be
   * authoritative regardless of that. See structure-line-items.ts.
   */
  groupId?: string | null;
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
  /**
   * WS11 (#950) — the line-item type (EQUIPMENT/SALE/etc, mirrors
   * `projectLineItems.type`). Was implicit (every row was effectively
   * EQUIPMENT) until SALE lines needed doc-type-specific handling: always
   * included regardless of status on delivery-docket/packing-list, always
   * excluded from the return-sheet (goods handed over, never expected back).
   * See gearflow-table.ts's filter block and document-composer.ts's
   * `getFilteredParentItems` — both must special-case `type === "SALE"`
   * identically (CLAUDE.md's PDF five-consumer-audit rule).
   */
  type?: string | null;
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
  /** Australian Business Number (or local equivalent). Rendered in the
   *  header, under the org's address/email, on every doc type. */
  org_abn: string;
  /** I4 (#1083) — the country-derived label for `org_abn`/`client_tax_id`
   *  ("ABN", "VAT number", "EIN", …), from `src/lib/countries.ts`. Both the
   *  org's own number (header) and the client's (details row) use this ONE
   *  label — it names the org's home-jurisdiction registration-number
   *  format, not a per-party thing. */
  org_business_number_label: string;
  org_logo: string | null;
  org_icon: string | null;
  org_tax_rate: number;
  org_tax_label: string;
  /** I4 (#1083) — country-derived invoice document heading ("TAX INVOICE"
   *  for AU/NZ, "INVOICE" elsewhere — "Tax Invoice" is an Australian/NZ
   *  legal term, not a global one). Only the invoice layout uses this. */
  org_invoice_heading: string;
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
  /** WS1 (#940) — the most recently ISSUED invoice's number for this project
   *  (see src/lib/invoices-read.ts getLatestInvoiceNumberForProject), or ""
   *  when nothing has been issued yet (a DRAFT invoice has no number). */
  invoice_number: string;
  /** Org-level document settings (src/lib/org-settings-types.ts `documents`).
   *  footer_text/footer_second_line: empty string = composer auto-generates
   *  from org_name/org_email/org_phone. */
  document_footer_text: string;
  document_footer_second_line: string;
  /** Org-authored plain-text T&Cs block — always populated for the quote;
   *  populated for the invoice only when the org's
   *  `showTermsAndConditionsOnInvoice` setting is on. */
  terms_and_conditions: string;
  /** Quote-only: a real computed "valid until" date (generatedAt + org's
   *  quoteValidityDays, default 30). */
  quote_valid_until: string;
  /** Invoice-only: a real computed "due" date — an ISSUED invoice's stamped
   *  `dueDate` row value, or (preview/no invoice yet) documentDate + org's
   *  paymentTermsDays (default 14), same fallback shape as quote_valid_until. */
  invoice_due_date: string;
  /** Org-authored plain-text payment/bank details block — invoice only,
   *  omitted (empty string) for every other doc type. */
  payment_details: string;

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
  /** Sum of every visible line's own `discount` field (the new per-item
   *  Discount column). `subtotal` is already net of these — they're baked
   *  into each line's `lineTotal` — so this is purely informational: shown
   *  as "Subtotal (before discounts)" + "Item Discounts" ABOVE the existing
   *  net `subtotal` row, never subtracted a second time. */
  itemDiscountTotal: number;
  discountPercent: number;
  discountAmount: number;
  taxLabel: string;
  taxAmount: number;
  total: number;
  depositPaid: number;
  balanceDue: number;
  documentColor: string;
  /** Bold "Due Date" row after Total/Balance Due — invoice only, already
   *  formatted for display. Omitted (undefined/empty) draws nothing. */
  dueDate?: string;
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
  /** A bold, document-coloured highlight line drawn after `docMeta` — used
   *  for the invoice's "Due: <date>" line so it can't be missed at the top
   *  of the document, next to the doc number/date. Undefined draws nothing. */
  highlightMeta?: string;
}

/**
 * Config for the draft-watermark plugin (#987) — the "this is NOT the document
 * the client has" banner stamped on a preview render. Only ever produced by the
 * `preview=1` path; a stored artifact never carries one.
 */
export interface DraftWatermarkConfig {
  title: string;
  subtitle: string;
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
