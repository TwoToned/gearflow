/**
 * System default template for Invoice documents.
 * Similar to Quote but: filters optional items, shows deposit/balance, includes ABN/payment terms.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData } from "../types";
import type { TemplateSettings } from "../template-settings";
import { getDefaultSettings } from "../template-settings";
import { buildHeaderConfig, buildFooterConfig, buildClientLines, buildProjectLines, buildTableConfig, buildFinancialConfig, getLogoModeOffset } from "./shared-builders";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2;

export function buildInvoiceTemplate(settings?: TemplateSettings): Template {
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
          name: "clientInfo",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 42 + o },
          width: CONTENT_W / 2 - 4,
          height: 30,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        {
          name: "projectInfo",
          type: "text",
          content: "",
          position: { x: MARGIN + CONTENT_W / 2 + 4, y: 42 + o },
          width: CONTENT_W / 2 - 4,
          height: 30,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        {
          name: "table",
          type: "gearflowTable",
          content: "",
          position: { x: MARGIN, y: 78 + o },
          width: CONTENT_W,
          height: 155,
        },
        {
          name: "financials",
          type: "gearflowFinancialSummary",
          content: "",
          position: { x: MARGIN, y: 235 + o },
          width: CONTENT_W,
          height: 30,
        },
        {
          name: "notes",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 268 + o },
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

export function buildInvoiceInputs(data: DocumentData, _callSheetDate?: Date, settings?: TemplateSettings): Record<string, string> {
  const s = settings || getDefaultSettings("invoice");
  const docColor = s.accentColor || data.org_document_color;

  const headerConfig = buildHeaderConfig(data, s, docColor);
  const clientInfo = buildClientLines(data, s);
  const projectLines = buildProjectLines(data, s);

  const tableConfig = buildTableConfig(data, s, "invoice", docColor, {
    filterOptional: true,
    filterByStatus: null,
  });

  const financialConfig = buildFinancialConfig(data, s, docColor);

  const footerConfig = buildFooterConfig(data, s);
  const notesText = s.other.showClientNotes ? (data.client_notes || "") : "";

  return {
    header: JSON.stringify(headerConfig),
    clientInfo,
    projectInfo: projectLines,
    table: JSON.stringify(tableConfig),
    financials: JSON.stringify(financialConfig),
    notes: notesText,
    footer: JSON.stringify(footerConfig),
  };
}
