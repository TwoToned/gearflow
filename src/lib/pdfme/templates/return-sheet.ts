/**
 * System default template for Return Sheet documents.
 * Filters to CHECKED_OUT or RETURNED items.
 * Columns: Ret checkbox, Item, Qty, Asset Tag, Condition (Good/Dmg/Missing), Notes
 * Includes signature section.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData, TablePluginConfig, PageHeaderConfig, FooterConfig, SignatureLineConfig } from "../types";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2;

export function buildReturnSheetTemplate(): Template {
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
          height: 175,
        },
        {
          name: "signature",
          type: "gearflowSignatureLine",
          content: "",
          position: { x: MARGIN, y: 245 },
          width: CONTENT_W,
          height: 20,
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

export function buildReturnSheetInputs(data: DocumentData): Record<string, string> {
  const headerConfig: PageHeaderConfig = {
    orgName: data.org_name,
    orgDetails: [data.org_address, data.org_phone, data.org_email].filter(Boolean).join("\n"),
    docTitle: "RETURN SHEET",
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
      documentType: "return-sheet",
      documentColor: data.org_document_color,
      showGroupHeaders: true,
      showKitChildren: true,
      showCheckboxes: true,
      showConditionColumns: true,
      showPricing: false,
      showBadges: false,
      showNotes: true,
      showPerUnitCheckboxes: true,
      showAssetTags: true,
      showCategories: false,
      showRowNumbers: false,
      filterOptional: false,
      filterByStatus: ["CHECKED_OUT", "RETURNED"],
    },
  };

  const signatureConfig: SignatureLineConfig = {
    columns: [
      { label: "Returned By", subLabel: "Name / Signature" },
      { label: "Received By", subLabel: "Name / Signature" },
      { label: "Date" },
    ],
  };

  const footerConfig: FooterConfig = {
    text: `${data.org_name} | ${data.org_email} | ${data.org_phone}`,
    secondLine: `Ref: ${data.project_number} | Generated ${data.document_date}`,
  };

  return {
    header: JSON.stringify(headerConfig),
    projectInfo: projectLines.join("\n"),
    table: JSON.stringify(tableConfig),
    signature: JSON.stringify(signatureConfig),
    footer: JSON.stringify(footerConfig),
  };
}
