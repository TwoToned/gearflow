/**
 * System default template for Delivery Docket documents.
 * Filters to checked-out items. Row numbering. "Nx" for bulk.
 * Columns: #, Description, Qty, Asset Tag, Received checkbox
 * Includes delivery info, signature section, and notes/discrepancies box.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData, SignatureLineConfig } from "../types";
import type { TemplateSettings } from "../template-settings";
import { getDefaultSettings } from "../template-settings";
import { buildHeaderConfig, buildFooterConfig, buildTableConfig, getLogoModeOffset } from "./shared-builders";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2;

export function buildDeliveryDocketTemplate(settings?: TemplateSettings): Template {
  const o = getLogoModeOffset(settings);
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
          height: 25 + o,
        },
        {
          name: "deliveryInfo",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 42 + o },
          width: CONTENT_W,
          height: 24,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        {
          name: "table",
          type: "gearflowTable",
          content: "",
          position: { x: MARGIN, y: 70 + o },
          width: CONTENT_W,
          height: 155,
        },
        {
          name: "discrepancies",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 230 + o },
          width: CONTENT_W,
          height: 10,
          fontSize: 8,
          fontColor: "#666666",
        },
        {
          name: "signature",
          type: "gearflowSignatureLine",
          content: "",
          position: { x: MARGIN, y: 245 + o },
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

export function buildDeliveryDocketInputs(data: DocumentData, _callSheetDate?: Date, settings?: TemplateSettings): Record<string, string> {
  const s = settings || getDefaultSettings("delivery-docket");
  const docColor = s.accentColor || data.org_document_color;

  const headerConfig = buildHeaderConfig(data, s, docColor);

  // Delivery info — specific to this doc type
  const deliveryLines: string[] = [data.project_name];
  if (s.details.showVenue && data.venue_name) deliveryLines.push(`Deliver To: ${data.venue_name}`);
  if (s.details.showVenue && data.venue_address) deliveryLines.push(data.venue_address);
  if (s.details.showSiteContact && data.site_contact_name) {
    let contactLine = `Site Contact: ${data.site_contact_name}`;
    if (data.site_contact_phone) contactLine += ` | Ph: ${data.site_contact_phone}`;
    deliveryLines.push(contactLine);
  }

  const tableConfig = buildTableConfig(data, s, "delivery-docket", docColor, {
    filterOptional: false,
    filterByStatus: ["CHECKED_OUT"],
  });

  const signatureConfig: SignatureLineConfig = s.other.showSignatureSection
    ? {
        columns: [
          { label: "Delivered By", subLabel: "Name / Signature" },
          { label: "Received By", subLabel: "Name / Signature" },
          { label: "Date" },
        ],
        orgName: data.org_name,
      }
    : { columns: [] };

  const footerConfig = buildFooterConfig(data, s);

  return {
    header: JSON.stringify(headerConfig),
    deliveryInfo: deliveryLines.join("\n"),
    table: JSON.stringify(tableConfig),
    discrepancies: s.other.showClientNotes ? "Notes / Discrepancies:" : "",
    signature: JSON.stringify(signatureConfig),
    footer: JSON.stringify(footerConfig),
  };
}
