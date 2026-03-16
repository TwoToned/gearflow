/**
 * System default template for Packing List (Pull Slip) documents.
 * Columns: Checkbox, Item, Qty, Asset Tag, Category
 * Shows per-unit checkboxes for qty > 1, total items count, total weight.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData, TablePluginConfig, PageHeaderConfig, FooterConfig } from "../types";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2;

export function buildPackingListTemplate(): Template {
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
          name: "projectInfo",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 42 },
          width: CONTENT_W,
          height: 18,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        {
          name: "table",
          type: "gearflowTable",
          content: "",
          position: { x: MARGIN, y: 64 },
          width: CONTENT_W,
          height: 200,
        },
        {
          name: "summary",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 268 },
          width: CONTENT_W,
          height: 8,
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

export function buildPackingListInputs(data: DocumentData): Record<string, string> {
  const headerConfig: PageHeaderConfig = {
    orgName: data.org_name,
    orgDetails: [data.org_address, data.org_phone, data.org_email].filter(Boolean).join("\n"),
    docTitle: "PULL SLIP",
    docMeta: `${data.project_number}\n${data.document_date}`,
    logoData: data.org_logo,
    iconData: data.org_icon,
    documentLogoMode: data.org_branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: data.org_branding?.showOrgNameOnDocuments !== false,
    documentColor: data.org_document_color,
  };

  const projectLines: string[] = [data.project_name];
  if (data.venue_name) projectLines.push(`Venue: ${data.venue_name}`);
  if (data.rental_start && data.rental_start !== "-") {
    projectLines.push(`Rental: ${data.rental_start}${data.rental_end && data.rental_end !== "-" ? ` - ${data.rental_end}` : ""}`);
  }

  const tableConfig: { items: typeof data.line_items; config: TablePluginConfig } = {
    items: data.line_items,
    config: {
      documentType: "packing-list",
      documentColor: data.org_document_color,
      showGroupHeaders: true,
      showKitChildren: true,
      showCheckboxes: true,
      showConditionColumns: false,
      showPricing: false,
      showBadges: false,
      showNotes: false,
      showPerUnitCheckboxes: true,
      showAssetTags: true,
      showCategories: true,
      showRowNumbers: false,
      filterOptional: false,
      filterByStatus: null,
    },
  };

  const footerConfig: FooterConfig = {
    text: `${data.org_name} | ${data.org_email} | ${data.org_phone}`,
    secondLine: `Ref: ${data.project_number} | Generated ${data.document_date}`,
  };

  const totalWeightStr = data.total_weight > 0 ? ` | Total Weight: ${data.total_weight.toFixed(1)}kg` : "";
  const summaryText = `Total Items: ${data.total_items}${totalWeightStr}`;

  return {
    header: JSON.stringify(headerConfig),
    projectInfo: projectLines.join("\n"),
    table: JSON.stringify(tableConfig),
    summary: summaryText,
    footer: JSON.stringify(footerConfig),
  };
}
