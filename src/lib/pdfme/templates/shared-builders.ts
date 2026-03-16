/**
 * Shared builder helpers — map TemplateSettings to plugin configs.
 * Used by all 6 document template builders to avoid duplicating mapping logic.
 */
import type {
  DocumentData,
  DocumentType,
  TablePluginConfig,
  FinancialSummaryConfig,
  PageHeaderConfig,
  FooterConfig,
} from "../types";
import type { TemplateSettings } from "../template-settings";

/** Build PageHeaderConfig from settings + data */
export function buildHeaderConfig(
  data: DocumentData,
  s: TemplateSettings,
  docColor: string
): PageHeaderConfig {
  const orgDetailParts: string[] = [];
  if (s.header.showOrgAddress && data.org_address) orgDetailParts.push(data.org_address);
  if (s.header.showOrgPhone && data.org_phone) orgDetailParts.push(data.org_phone);
  if (s.header.showOrgEmail && data.org_email) orgDetailParts.push(data.org_email);
  if (s.header.showOrgWebsite && data.org_website) orgDetailParts.push(data.org_website);

  const metaParts = [data.project_number];
  if (s.details.showDocumentDate) metaParts.push(data.document_date);

  return {
    orgName: data.org_name,
    orgDetails: orgDetailParts.join("\n"),
    docTitle: s.header.documentTitle,
    docMeta: metaParts.join("\n"),
    logoData: data.org_logo,
    iconData: data.org_icon,
    documentLogoMode: s.header.logoMode,
    showOrgNameOnDocuments: s.header.showOrgName,
    documentColor: docColor,
  };
}

/** Build client info text block from settings + data */
export function buildClientLines(data: DocumentData, s: TemplateSettings): string {
  const lines: string[] = [];
  if (s.details.showClientName && data.client_name) lines.push(data.client_name);
  if (s.details.showClientContact && data.client_contact) lines.push(`Attn: ${data.client_contact}`);
  if (s.details.showClientEmail && data.client_email) lines.push(data.client_email);
  if (s.details.showClientAddress && data.client_billing_address) lines.push(data.client_billing_address);
  if (s.details.showClientTaxId && data.client_tax_id) lines.push(`ABN: ${data.client_tax_id}`);
  return lines.length > 0 ? lines.join("\n") : "-";
}

/** Build project info text block from settings + data */
export function buildProjectLines(data: DocumentData, s: TemplateSettings): string {
  const lines: string[] = [];
  if (s.details.showProjectName) lines.push(data.project_name);
  if (s.details.showProjectNumber && !lines.some((l) => l.includes(data.project_number))) {
    // project number is usually in the header meta, but if they want it here too
  }
  if (s.details.showVenue && data.venue_name) lines.push(`Venue: ${data.venue_name}`);
  if (s.details.showRentalDates && data.rental_start && data.rental_start !== "-") {
    const end = data.rental_end && data.rental_end !== "-" ? ` - ${data.rental_end}` : "";
    lines.push(`Rental: ${data.rental_start}${end}`);
  }
  if (s.details.showEventDates && data.event_start && data.event_start !== "-") {
    const end = data.event_end && data.event_end !== "-" ? ` - ${data.event_end}` : "";
    lines.push(`Event: ${data.event_start}${end}`);
  }
  if (s.details.showPaymentTerms && data.client_payment_terms) {
    lines.push(`Payment Terms: ${data.client_payment_terms}`);
  }
  if (s.details.showSiteContact && data.site_contact_name) {
    let contactLine = `Site Contact: ${data.site_contact_name}`;
    if (data.site_contact_phone) contactLine += ` | Ph: ${data.site_contact_phone}`;
    lines.push(contactLine);
  }
  return lines.length > 0 ? lines.join("\n") : "-";
}

/** Build table plugin config from settings */
export function buildTableConfig(
  data: DocumentData,
  s: TemplateSettings,
  docType: DocumentType,
  docColor: string,
  overrides: { filterOptional: boolean; filterByStatus: string[] | null }
): { items: typeof data.line_items; config: TablePluginConfig } {
  return {
    items: data.line_items,
    config: {
      documentType: docType,
      documentColor: docColor,
      showGroupHeaders: s.table.showGroupHeaders,
      showKitChildren: s.table.showKitChildren,
      showCheckboxes: s.table.showCheckboxes,
      showConditionColumns: s.table.showConditionColumns,
      showPricing: s.table.showPricing,
      showBadges: s.table.showBadges,
      showNotes: s.table.showNotes,
      showPerUnitCheckboxes: s.table.showPerUnitCheckboxes,
      showAssetTags: s.table.showAssetTags,
      showCategories: s.table.showCategories,
      showRowNumbers: s.table.showRowNumbers,
      filterOptional: overrides.filterOptional,
      filterByStatus: overrides.filterByStatus,
    },
  };
}

/** Build financial summary config from settings */
export function buildFinancialConfig(
  data: DocumentData,
  s: TemplateSettings,
  docColor: string,
  overrides?: { depositPaid?: number; balanceDue?: number }
): FinancialSummaryConfig {
  return {
    subtotal: s.totals.showSubtotal ? data.subtotal : 0,
    discountPercent: s.totals.showDiscount ? data.discount_percent : 0,
    discountAmount: s.totals.showDiscount ? data.discount_amount : 0,
    taxLabel: data.tax_label,
    taxAmount: s.totals.showTax ? data.tax_amount : 0,
    total: s.totals.showTotal ? data.total : 0,
    depositPaid: s.totals.showDeposit ? (overrides?.depositPaid ?? data.deposit_paid) : 0,
    balanceDue: s.totals.showBalance ? (overrides?.balanceDue ?? data.balance_due) : 0,
    documentColor: docColor,
  };
}

/**
 * Extra vertical offset (mm) when logo mode is active.
 * Logo renders above the standard org-name / details block,
 * so everything below the header needs to shift down.
 */
export function getLogoModeOffset(s?: TemplateSettings): number {
  if (!s) return 0;
  if (s.header.logoMode === "logo") return 22; // ~50pt logo + 8pt gap ≈ 22mm
  return 0;
}

/** Build footer config from settings */
export function buildFooterConfig(data: DocumentData, s: TemplateSettings): FooterConfig {
  if (!s.footer.showFooter) {
    return { text: "", secondLine: "" };
  }
  const primaryText = s.footer.primaryText || `${data.org_name} | ${data.org_email} | ${data.org_phone}`;
  return {
    text: primaryText,
    secondLine: s.footer.secondaryText,
  };
}
