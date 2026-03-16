/**
 * System default template for Return Sheet documents.
 * Filters to CHECKED_OUT or RETURNED items.
 * Columns: Ret checkbox, Item, Qty, Asset Tag, Condition (Good/Dmg/Missing), Notes
 * Includes signature section.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData, SignatureLineConfig } from "../types";
import type { TemplateSettings } from "../template-settings";
import { getDefaultSettings } from "../template-settings";
import { buildHeaderConfig, buildFooterConfig, buildProjectLines, buildTableConfig, getLogoModeOffset } from "./shared-builders";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2;

export function buildReturnSheetTemplate(settings?: TemplateSettings): Template {
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
          height: 175,
        },
        {
          name: "signature",
          type: "gearflowSignatureLine",
          content: "",
          position: { x: MARGIN, y: 245 + o },
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

export function buildReturnSheetInputs(data: DocumentData, _callSheetDate?: Date, settings?: TemplateSettings): Record<string, string> {
  const s = settings || getDefaultSettings("return-sheet");
  const docColor = s.accentColor || data.org_document_color;

  const headerConfig = buildHeaderConfig(data, s, docColor);
  const projectLines = buildProjectLines(data, s);

  const tableConfig = buildTableConfig(data, s, "return-sheet", docColor, {
    filterOptional: false,
    filterByStatus: ["CHECKED_OUT", "RETURNED"],
  });

  const signatureConfig: SignatureLineConfig = s.other.showSignatureSection
    ? {
        columns: [
          { label: "Returned By", subLabel: "Name / Signature" },
          { label: "Received By", subLabel: "Name / Signature" },
          { label: "Date" },
        ],
      }
    : { columns: [] };

  const footerConfig = buildFooterConfig(data, s);

  return {
    header: JSON.stringify(headerConfig),
    projectInfo: projectLines,
    table: JSON.stringify(tableConfig),
    signature: JSON.stringify(signatureConfig),
    footer: JSON.stringify(footerConfig),
  };
}
