/**
 * System default template for Call Sheet documents.
 * Landscape A4 (297mm × 210mm). Crew table with project/location/contact info.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData } from "../types";
import type { TemplateSettings } from "../template-settings";
import { getDefaultSettings } from "../template-settings";
import { formatDate } from "../plugins/helpers";
import { buildHeaderConfig, buildFooterConfig, getLogoModeOffset } from "./shared-builders";

const PAGE_WIDTH = 297; // landscape
const PAGE_HEIGHT = 210;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2; // 269mm

export function buildCallSheetTemplate(settings?: TemplateSettings): Template {
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
        // Three-column info row
        {
          name: "projectInfo",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 42 + o },
          width: CONTENT_W / 3 - 4,
          height: 22,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        {
          name: "locationInfo",
          type: "text",
          content: "",
          position: { x: MARGIN + CONTENT_W / 3, y: 42 + o },
          width: CONTENT_W / 3 - 4,
          height: 22,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        {
          name: "siteContact",
          type: "text",
          content: "",
          position: { x: MARGIN + (CONTENT_W / 3) * 2, y: 42 + o },
          width: CONTENT_W / 3 - 4,
          height: 22,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        // Crew table
        {
          name: "crewTable",
          type: "gearflowCrewTable",
          content: "",
          position: { x: MARGIN, y: 68 + o },
          width: CONTENT_W,
          height: 110,
        },
        // Crew notes
        {
          name: "crewNotes",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 182 + o },
          width: CONTENT_W,
          height: 10,
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

export function buildCallSheetInputs(data: DocumentData, callSheetDate?: Date, settings?: TemplateSettings): Record<string, string> {
  const s = settings || getDefaultSettings("call-sheet");
  const docColor = s.accentColor || data.org_document_color;

  const dateStr = callSheetDate
    ? formatDate(callSheetDate.toISOString())
    : data.load_in_date !== "-"
      ? data.load_in_date
      : data.event_start !== "-"
        ? data.event_start
        : data.rental_start;

  // Override the header meta with call sheet date
  const headerConfig = buildHeaderConfig(data, s, docColor);
  headerConfig.docMeta = `${data.project_number}\n${dateStr}`;

  const projectLines = [data.project_name, `Date: ${dateStr}`];

  const locationLines = [data.venue_name || "-"];
  if (data.venue_address) locationLines.push(data.venue_address);

  const contactLines: string[] = [];
  if (s.details.showSiteContact && data.site_contact_name) {
    contactLines.push(data.site_contact_name);
    if (data.site_contact_phone) contactLines.push(`Ph: ${data.site_contact_phone}`);
    if (data.site_contact_email) contactLines.push(data.site_contact_email);
  } else {
    contactLines.push("-");
  }

  const crewTableConfig = {
    crew: data.crew,
    documentColor: docColor,
  };

  const footerConfig = buildFooterConfig(data, s);
  const crewNotes = s.other.showCrewNotes && data.crew_notes ? `Notes: ${data.crew_notes}` : "";

  return {
    header: JSON.stringify(headerConfig),
    projectInfo: projectLines.join("\n"),
    locationInfo: locationLines.join("\n"),
    siteContact: contactLines.join("\n"),
    crewTable: JSON.stringify(crewTableConfig),
    crewNotes,
    footer: JSON.stringify(footerConfig),
  };
}
