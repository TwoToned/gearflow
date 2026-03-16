/**
 * System default template for Invoice documents.
 * Similar to Quote but: filters optional items, shows deposit/balance, includes ABN/payment terms.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData, TablePluginConfig, FinancialSummaryConfig, PageHeaderConfig, FooterConfig } from "../types";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2;

export function buildInvoiceTemplate(): Template {
  return {
    basePdf: {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      padding: [MARGIN, MARGIN, MARGIN, MARGIN],
    },
    schemas: [
      [
        {
          name: "header",
          type: "gearflowPageHeader",
          content: "",
          position: { x: MARGIN, y: MARGIN },
          width: CONTENT_W,
          height: 25,
        },
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
        {
          name: "table",
          type: "gearflowTable",
          content: "",
          position: { x: MARGIN, y: 78 },
          width: CONTENT_W,
          height: 155,
        },
        {
          name: "financials",
          type: "gearflowFinancialSummary",
          content: "",
          position: { x: MARGIN, y: 235 },
          width: CONTENT_W,
          height: 30,
        },
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

export function buildInvoiceInputs(data: DocumentData): Record<string, string> {
  const headerConfig: PageHeaderConfig = {
    orgName: data.org_name,
    orgDetails: [data.org_address, data.org_phone, data.org_email, data.org_website].filter(Boolean).join("\n"),
    docTitle: "INVOICE",
    docMeta: `${data.project_number}\n${data.document_date}`,
    logoData: data.org_logo,
    iconData: data.org_icon,
    documentLogoMode: data.org_branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: data.org_branding?.showOrgNameOnDocuments !== false,
    documentColor: data.org_document_color,
  };

  // Client info with ABN and payment terms
  const clientLines: string[] = [];
  if (data.client_name) clientLines.push(data.client_name);
  if (data.client_contact) clientLines.push(`Attn: ${data.client_contact}`);
  if (data.client_email) clientLines.push(data.client_email);
  if (data.client_billing_address) clientLines.push(data.client_billing_address);
  if (data.client_tax_id) clientLines.push(`ABN: ${data.client_tax_id}`);

  // Project info with payment terms
  const projectLines: string[] = [data.project_name];
  if (data.venue_name) projectLines.push(`Venue: ${data.venue_name}`);
  if (data.rental_start && data.rental_start !== "-") {
    const rentalPeriod = data.rental_end && data.rental_end !== "-"
      ? `${data.rental_start} - ${data.rental_end}`
      : data.rental_start;
    projectLines.push(`Rental: ${rentalPeriod}`);
  }
  if (data.client_payment_terms) projectLines.push(`Payment Terms: ${data.client_payment_terms}`);

  const tableConfig: { items: typeof data.line_items; config: TablePluginConfig } = {
    items: data.line_items,
    config: {
      documentType: "invoice",
      documentColor: data.org_document_color,
      showGroupHeaders: true,
      showKitChildren: true,
      showCheckboxes: false,
      showConditionColumns: false,
      showPricing: true,
      showBadges: false,
      showNotes: true,
      showPerUnitCheckboxes: false,
      showAssetTags: false,
      showCategories: false,
      showRowNumbers: false,
      filterOptional: true, // Invoice excludes optional items
      filterByStatus: null,
    },
  };

  const financialConfig: FinancialSummaryConfig = {
    subtotal: data.subtotal,
    discountPercent: data.discount_percent,
    discountAmount: data.discount_amount,
    taxLabel: data.tax_label,
    taxAmount: data.tax_amount,
    total: data.total,
    depositPaid: data.deposit_paid,
    balanceDue: data.balance_due,
    documentColor: data.org_document_color,
  };

  const footerConfig: FooterConfig = {
    text: `${data.org_name} | ${data.org_email} | ${data.org_phone}`,
    secondLine: `Ref: ${data.project_number} | Generated ${data.document_date}`,
  };

  return {
    header: JSON.stringify(headerConfig),
    clientInfo: clientLines.length > 0 ? clientLines.join("\n") : "-",
    projectInfo: projectLines.join("\n"),
    table: JSON.stringify(tableConfig),
    financials: JSON.stringify(financialConfig),
    notes: data.client_notes || "",
    footer: JSON.stringify(footerConfig),
  };
}
