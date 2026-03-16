/**
 * System default template for Delivery Docket documents.
 * Filters to checked-out items. Row numbering. "Nx" for bulk.
 * Columns: #, Description, Qty, Asset Tag, Received checkbox
 * Includes delivery info, signature section, and notes/discrepancies box.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData, TablePluginConfig, PageHeaderConfig, FooterConfig, SignatureLineConfig } from "../types";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2;

export function buildDeliveryDocketTemplate(): Template {
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
          name: "deliveryInfo",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 42 },
          width: CONTENT_W,
          height: 24,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        {
          name: "table",
          type: "gearflowTable",
          content: "",
          position: { x: MARGIN, y: 70 },
          width: CONTENT_W,
          height: 155,
        },
        {
          name: "discrepancies",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 230 },
          width: CONTENT_W,
          height: 10,
          fontSize: 8,
          fontColor: "#666666",
        },
        {
          name: "signature",
          type: "gearflowSignatureLine",
          content: "",
          position: { x: MARGIN, y: 245 },
          width: CONTENT_W,
          height: 25,
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

export function buildDeliveryDocketInputs(data: DocumentData): Record<string, string> {
  const headerConfig: PageHeaderConfig = {
    orgName: data.org_name,
    orgDetails: [data.org_address, data.org_phone, data.org_email].filter(Boolean).join("\n"),
    docTitle: "DELIVERY DOCKET",
    docMeta: `${data.project_number}\n${data.document_date}`,
    logoData: data.org_logo,
    iconData: data.org_icon,
    documentLogoMode: data.org_branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: data.org_branding?.showOrgNameOnDocuments !== false,
    documentColor: data.org_document_color,
  };

  // Delivery info
  const deliveryLines: string[] = [data.project_name];
  if (data.venue_name) deliveryLines.push(`Deliver To: ${data.venue_name}`);
  if (data.venue_address) deliveryLines.push(data.venue_address);
  if (data.site_contact_name) {
    let contactLine = `Site Contact: ${data.site_contact_name}`;
    if (data.site_contact_phone) contactLine += ` | Ph: ${data.site_contact_phone}`;
    deliveryLines.push(contactLine);
  }

  const tableConfig: { items: typeof data.line_items; config: TablePluginConfig } = {
    items: data.line_items,
    config: {
      documentType: "delivery-docket",
      documentColor: data.org_document_color,
      showGroupHeaders: true,
      showKitChildren: true,
      showCheckboxes: true,
      showConditionColumns: false,
      showPricing: false,
      showBadges: false,
      showNotes: false,
      showPerUnitCheckboxes: false,
      showAssetTags: true,
      showCategories: false,
      showRowNumbers: true,
      filterOptional: false,
      filterByStatus: ["CHECKED_OUT"],
    },
  };

  const signatureConfig: SignatureLineConfig = {
    columns: [
      { label: "Delivered By", subLabel: "Name / Signature" },
      { label: "Received By", subLabel: "Name / Signature" },
      { label: "Date" },
    ],
    orgName: data.org_name,
  };

  const footerConfig: FooterConfig = {
    text: `${data.org_name} | ${data.org_email} | ${data.org_phone}`,
    secondLine: `Ref: ${data.project_number} | Generated ${data.document_date}`,
  };

  return {
    header: JSON.stringify(headerConfig),
    deliveryInfo: deliveryLines.join("\n"),
    table: JSON.stringify(tableConfig),
    discrepancies: "Notes / Discrepancies:",
    signature: JSON.stringify(signatureConfig),
    footer: JSON.stringify(footerConfig),
  };
}
