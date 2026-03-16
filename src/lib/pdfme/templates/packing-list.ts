/**
 * System default template for Packing List (Pull Slip) documents.
 * Columns: Checkbox, Item, Qty, Asset Tag, Category
 * Shows per-unit checkboxes for qty > 1, total items count, total weight.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData } from "../types";
import type { TemplateSettings } from "../template-settings";
import { getDefaultSettings } from "../template-settings";
import { buildHeaderConfig, buildFooterConfig, buildProjectLines, buildTableConfig, getLogoModeOffset } from "./shared-builders";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2;

export function buildPackingListTemplate(settings?: TemplateSettings): Template {
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
          name: "projectInfo",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 42 + o },
          width: CONTENT_W,
          height: 18,
          fontSize: 9,
          fontColor: "#1a1a1a",
        },
        {
          name: "table",
          type: "gearflowTable",
          content: "",
          position: { x: MARGIN, y: 64 + o },
          width: CONTENT_W,
          height: 200,
        },
        {
          name: "summary",
          type: "text",
          content: "",
          position: { x: MARGIN, y: 268 + o },
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

export function buildPackingListInputs(data: DocumentData, _callSheetDate?: Date, settings?: TemplateSettings): Record<string, string> {
  const s = settings || getDefaultSettings("packing-list");
  const docColor = s.accentColor || data.org_document_color;

  const headerConfig = buildHeaderConfig(data, s, docColor);
  const projectLines = buildProjectLines(data, s);

  const tableConfig = buildTableConfig(data, s, "packing-list", docColor, {
    filterOptional: false,
    filterByStatus: null,
  });

  const footerConfig = buildFooterConfig(data, s);

  const totalWeightStr = data.total_weight > 0 ? ` | Total Weight: ${data.total_weight.toFixed(1)}kg` : "";
  const summaryText = s.other.showSummaryLine ? `Total Items: ${data.total_items}${totalWeightStr}` : "";

  return {
    header: JSON.stringify(headerConfig),
    projectInfo: projectLines,
    table: JSON.stringify(tableConfig),
    summary: summaryText,
    footer: JSON.stringify(footerConfig),
  };
}
