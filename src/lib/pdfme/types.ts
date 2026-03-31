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
  /** True for synthetic rows representing a ProjectGroup (hides individual equipment) */
  isGroupRow?: boolean;
  isOptional: boolean;
  isKitChild?: boolean;
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
  // Subhire
  isSubhire?: boolean;
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

  // Complex data (JSON-stringified for plugins)
  line_items: DocumentLineItem[];
  crew: CrewEntry[];

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
