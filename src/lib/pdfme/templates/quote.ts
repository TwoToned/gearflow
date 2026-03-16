/**
 * System default template for Quote documents.
 * Replicates the current @react-pdf/renderer QuotePDF layout.
 *
 * A4 portrait: 210mm × 297mm, 14mm margins (~40pt)
 * Content area: 182mm × 269mm
 */
import type { Template } from "@pdfme/common";
import type { DocumentData, TablePluginConfig, FinancialSummaryConfig, PageHeaderConfig, FooterConfig } from "../types";
import { formatCurrency, formatDate } from "../plugins/helpers";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2; // 182mm

export function buildQuoteTemplate(): Template {
  return {
    basePdf: {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      padding: [MARGIN, MARGIN, MARGIN, MARGIN],
    },
    schemas: [
      [
        // Header
        {
          name: "header",
          type: "gearflowPageHeader",
          content: "",
          position: { x: MARGIN, y: MARGIN },
          width: CONTENT_W,
          height: 25,
        },
        // Client info (left column) — using built-in text
        {
          name: "clientInfo",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 42 },
          width: CONTENT_W / 2 - 4,
          height: 30,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        // Project info (right column)
        {
          name: "projectInfo",
          type: "text",
          content: "",
          position: { x: MARGIN + CONTENT_W / 2 + 4, y: 42 },
          width: CONTENT_W / 2 - 4,
          height: 30,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        // Equipment table
        {
          name: "table",
          type: "gearflowTable",
          content: "",
          position: { x: MARGIN, y: 78 },
          width: CONTENT_W,
          height: 160,
        },
        // Financial summary
        {
          name: "financials",
          type: "gearflowFinancialSummary",
          content: "",
          position: { x: MARGIN, y: 240 },
          width: CONTENT_W,
          height: 25,
        },
        // Client notes
        {
          name: "notes",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 268 },
          width: CONTENT_W,
          height: 12,
          fontSize: 8,
          fontColor: "#666666",
        },
        // Footer
        {
          name: "footer",
          type: "gearflowPageFooter",
          content: "",
          position: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 10 },
          width: CONTENT_W,
          height: 10,
        },
      ],
    ],
  };
}

/**
 * Build inputs for the quote template from DocumentData.
 */
export function buildQuoteInputs(data: DocumentData): Record<string, string> {
  // Header config
  const headerConfig: PageHeaderConfig = {
    orgName: data.org_name,
    orgDetails: [data.org_address, data.org_phone, data.org_email, data.org_website].filter(Boolean).join("\n"),
    docTitle: "QUOTE",
    docMeta: `${data.project_number}\n${data.document_date}`,
    logoData: data.org_logo,
    iconData: data.org_icon,
    documentLogoMode: data.org_branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: data.org_branding?.showOrgNameOnDocuments !== false,
    documentColor: data.org_document_color,
  };

  // Client info text block
  const clientLines: string[] = [];
  if (data.client_name) clientLines.push(data.client_name);
  if (data.client_contact) clientLines.push(`Attn: ${data.client_contact}`);
  if (data.client_email) clientLines.push(data.client_email);
  if (data.client_billing_address) clientLines.push(data.client_billing_address);
  const clientInfo = clientLines.length > 0 ? clientLines.join("\n") : "-";

  // Project info text block
  const projectLines: string[] = [data.project_name];
  if (data.venue_name) projectLines.push(`Venue: ${data.venue_name}`);
  if (data.rental_start && data.rental_start !== "-") {
    const rentalPeriod = data.rental_end && data.rental_end !== "-"
      ? `${data.rental_start} - ${data.rental_end}`
      : data.rental_start;
    projectLines.push(`Rental: ${rentalPeriod}`);
  }
  if (data.event_start && data.event_start !== "-") {
    const eventPeriod = data.event_end && data.event_end !== "-"
      ? `${data.event_start} - ${data.event_end}`
      : data.event_start;
    projectLines.push(`Event: ${eventPeriod}`);
  }

  // Table config
  const tableConfig: { items: typeof data.line_items; config: TablePluginConfig } = {
    items: data.line_items,
    config: {
      documentType: "quote",
      documentColor: data.org_document_color,
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
      filterOptional: false,
      filterByStatus: null,
    },
  };

  // Financial summary
  const financialConfig: FinancialSummaryConfig = {
    subtotal: data.subtotal,
    discountPercent: data.discount_percent,
    discountAmount: data.discount_amount,
    taxLabel: data.tax_label,
    taxAmount: data.tax_amount,
    total: data.total,
    depositPaid: 0, // Quote doesn't show deposit
    balanceDue: 0,
    documentColor: data.org_document_color,
  };

  // Footer
  const footerConfig: FooterConfig = {
    text: `${data.org_name} | ${data.org_email} | ${data.org_phone}`,
    secondLine: "This quote is valid for 30 days from the date of issue.",
  };

  // Notes
  const notesText = data.client_notes || "";

  return {
    header: JSON.stringify(headerConfig),
    clientInfo,
    projectInfo: projectLines.join("\n"),
    table: JSON.stringify(tableConfig),
    financials: JSON.stringify(financialConfig),
    notes: notesText,
    footer: JSON.stringify(footerConfig),
  };
}
