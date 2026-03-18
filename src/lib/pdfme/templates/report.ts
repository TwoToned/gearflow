/**
 * Generic report PDF template — landscape A4 with multi-page table support.
 * Used by the custom report builder and pre-built reports.
 *
 * pdfme multi-page: `schemas` is Schema[][] (one inner array per page).
 * Each input object renders ALL pages, so we use unique field names per page
 * (e.g. dataTable_1, dataTable_2) and a SINGLE input object with all keys.
 */
import type { Template } from "@pdfme/common";
import type { PageHeaderConfig, FooterConfig } from "../types";
import type { DataTableConfig, DataTableColumn } from "../plugins/gearflow-data-table";
import type { SummaryBoxConfig } from "../plugins/gearflow-summary-box";
import { formatDate } from "../plugins/helpers";
import type { ReportResult, ColumnConfig } from "@/lib/report-types";
import { FIELD_DEFINITIONS } from "@/lib/report-types";

const PAGE_WIDTH = 297; // landscape A4 mm
const PAGE_HEIGHT = 210;
const MARGIN = 14;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2;

// Data table row/header heights in points (must match gearflow-data-table plugin)
const ROW_HEIGHT_PT = 14;
const HEADER_HEIGHT_PT = 16;
const PT_PER_MM = 72 / 25.4; // ~2.835

// Page 2+: smaller header (18mm), table starts at y=36mm
const CONTINUATION_HEADER_H = 18;
const PAGEN_TABLE_Y = MARGIN + CONTINUATION_HEADER_H + 4; // 36mm
const PAGEN_TABLE_AVAIL_MM = PAGE_HEIGHT - MARGIN - 10 - PAGEN_TABLE_Y; // 150mm
const PAGEN_ROWS = Math.floor(
  (PAGEN_TABLE_AVAIL_MM * PT_PER_MM - HEADER_HEIGHT_PT) / ROW_HEIGHT_PT
);

interface OrgData {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  branding?: {
    primaryColor?: string;
    documentColor?: string;
    logoUrl?: string;
    iconUrl?: string;
    documentLogoMode?: "logo" | "icon" | "none";
    showOrgNameOnDocuments?: boolean;
  };
  logoData?: string | null;
  iconData?: string | null;
}

interface ReportPdfData {
  title: string;
  subtitle?: string;
  result: ReportResult;
  dataSource?: string;
}

/**
 * Build a multi-page template with unique field names per page.
 * Field names are suffixed with page index: header_0, dataTable_0, footer_0, etc.
 * @param summaryItemCount - number of summary items (affects page 1 layout)
 */
export function buildReportTemplate(pageCount: number, summaryItemCount: number = 1): Template {
  // Calculate summary box height in mm based on item count
  const summaryRows = Math.ceil(summaryItemCount / 5);
  const SUMMARY_ROW_HEIGHT_PT = 38;
  const SUMMARY_ROW_GAP_PT = 4;
  const summaryHeightPt = summaryRows * SUMMARY_ROW_HEIGHT_PT + (summaryRows - 1) * SUMMARY_ROW_GAP_PT + 8;
  const summaryHeightMm = summaryHeightPt / PT_PER_MM;
  const summaryBoxY = 52; // mm, below header (logo + org details + title need ~35mm)
  const page1TableY = summaryBoxY + summaryHeightMm + 2; // 2mm gap after summary
  const schemas: Template["schemas"] = [];

  // Page 1: header + summary + table + footer
  schemas.push([
    {
      name: "header_0",
      type: "gearflowPageHeader",
      content: "",
      position: { x: MARGIN, y: MARGIN },
      width: CONTENT_W,
      height: 35,
    },
    {
      name: "summaryBox_0",
      type: "gearflowSummaryBox",
      content: "",
      position: { x: MARGIN, y: summaryBoxY },
      width: CONTENT_W,
      height: summaryHeightMm,
    },
    {
      name: "dataTable_0",
      type: "gearflowDataTable",
      content: "",
      position: { x: MARGIN, y: page1TableY },
      width: CONTENT_W,
      height: 1, // minimal — plugin draws downward from y, ignores height
    },
    {
      name: "footer_0",
      type: "gearflowPageFooter",
      content: "",
      position: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 10 },
      width: CONTENT_W,
      height: 10,
    },
  ]);

  // Pages 2+: continuation header + table + footer
  for (let i = 1; i < pageCount; i++) {
    schemas.push([
      {
        name: `header_${i}`,
        type: "gearflowPageHeader",
        content: "",
        position: { x: MARGIN, y: MARGIN },
        width: CONTENT_W,
        height: CONTINUATION_HEADER_H,
      },
      {
        name: `dataTable_${i}`,
        type: "gearflowDataTable",
        content: "",
        position: { x: MARGIN, y: PAGEN_TABLE_Y },
        width: CONTENT_W,
        height: 1,
      },
      {
        name: `footer_${i}`,
        type: "gearflowPageFooter",
        content: "",
        position: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 10 },
        width: CONTENT_W,
        height: 10,
      },
    ]);
  }

  return {
    basePdf: {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      padding: [MARGIN, MARGIN, MARGIN, MARGIN],
    },
    schemas,
  };
}

/**
 * Format a cell value for PDF display.
 */
function formatCellValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return formatDate(new Date(value));
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(value);
}

/**
 * Resolve a human-readable label for a column field.
 */
function resolveColumnLabel(col: ColumnConfig, dataSource: string): string {
  if (col.label) return col.label;

  const fieldDefs = FIELD_DEFINITIONS[dataSource as keyof typeof FIELD_DEFINITIONS];
  if (fieldDefs) {
    const def = fieldDefs.find((f) => f.field === col.field);
    if (def?.label) return def.label;
  }

  // camelCase/dot-path → Title Case
  const lastPart = col.field.split(".").pop() || col.field;
  return lastPart
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

/**
 * Build a SINGLE input object with unique keys per page.
 * pdfme renders all schema pages for each input, so we need exactly one input
 * with keys like header_0, dataTable_0, footer_0, header_1, dataTable_1, etc.
 */
export function buildReportInputs(
  data: ReportPdfData,
  orgData: OrgData
): Record<string, string>[] {
  const docColor = orgData.branding?.documentColor || "#0d9488";
  const { result } = data;
  const dataSource = data.dataSource || "";

  // ── Shared configs ──

  const footerConfig: FooterConfig = {
    text: [orgData.name, orgData.email, orgData.phone].filter(Boolean).join(" | "),
    secondLine: `${data.title} | Generated ${formatDate(new Date())}`,
  };

  // Build column definitions once
  const visibleColumns = result.columns.filter((c: ColumnConfig) => c.visible);
  const columns: DataTableColumn[] = visibleColumns.map((col: ColumnConfig) => ({
    key: col.field,
    label: resolveColumnLabel(col, dataSource),
    width: col.width || 1,
  }));

  // Format all rows
  const allRows = result.rows.map((row: Record<string, unknown>) => {
    const mapped: Record<string, string | number | null> = {};
    for (const col of visibleColumns) {
      const val = formatCellValue(row[col.field]);
      mapped[col.field] = val !== "" ? val : null;
    }
    return mapped;
  });

  // ── Build summary items first (needed for page 1 row count) ──

  const summaryItems: { label: string; value: string | number }[] = [];
  if (result.aggregations && Object.keys(result.aggregations).length > 0) {
    const fieldDefs = dataSource ? FIELD_DEFINITIONS[dataSource as keyof typeof FIELD_DEFINITIONS] : undefined;
    const aggFnLabels: Record<string, string> = { sum: "Sum", avg: "Avg", count: "Count" };

    for (const [key, val] of Object.entries(result.aggregations)) {
      if (key === "totalRows") continue;

      // Keys are like "sum:_count.assets" or "avg:defaultRentalPrice"
      const colonIdx = key.indexOf(":");
      const aggFn = colonIdx > -1 ? key.slice(0, colonIdx) : "";
      const fieldKey = colonIdx > -1 ? key.slice(colonIdx + 1) : key;

      // Look up field label from FIELD_DEFINITIONS
      const fieldDef = fieldDefs?.find((f) => f.field === fieldKey);
      const fieldLabel = fieldDef?.label || fieldKey
        .replace(/^_/, "")
        .replace(/\./g, " ")
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (s) => s.toUpperCase())
        .trim();

      const fnLabel = aggFnLabels[aggFn] || aggFn.charAt(0).toUpperCase() + aggFn.slice(1);
      const label = `${fieldLabel} (${fnLabel})`;

      summaryItems.push({
        label,
        value: typeof val === "number" && !Number.isInteger(val)
          ? val.toFixed(2)
          : val,
      });
    }
  }
  summaryItems.push({ label: "Total Rows", value: result.totalRows });

  // ── Split rows across pages (page 1 has fewer rows due to summary box) ──

  const p1Rows = getPage1Rows(summaryItems.length);
  const rowChunks: Record<string, string | number | null>[][] = [];
  if (allRows.length <= p1Rows) {
    rowChunks.push(allRows);
  } else {
    rowChunks.push(allRows.slice(0, p1Rows));
    let offset = p1Rows;
    while (offset < allRows.length) {
      rowChunks.push(allRows.slice(offset, offset + PAGEN_ROWS));
      offset += PAGEN_ROWS;
    }
  }

  const totalPages = rowChunks.length;

  // ── Build single input object with unique keys per page ──

  const input: Record<string, string> = {};

  // Page 1
  const headerConfig: PageHeaderConfig = {
    orgName: orgData.name,
    orgDetails: [orgData.address, orgData.phone, orgData.email].filter(Boolean).join("\n"),
    docTitle: data.title.toUpperCase(),
    docMeta: data.subtitle
      ? `${data.subtitle} | Generated ${formatDate(new Date())}`
      : `Generated ${formatDate(new Date())}`,
    logoData: orgData.logoData ?? null,
    iconData: orgData.iconData ?? null,
    documentLogoMode: orgData.branding?.documentLogoMode || "icon",
    showOrgNameOnDocuments: orgData.branding?.showOrgNameOnDocuments !== false,
    documentColor: docColor,
  };

  const page1Table: DataTableConfig = {
    columns,
    rows: rowChunks[0] || [],
    documentColor: docColor,
  };

  input["header_0"] = JSON.stringify(headerConfig);
  input["summaryBox_0"] = JSON.stringify({ items: summaryItems, documentColor: docColor } as SummaryBoxConfig);
  input["dataTable_0"] = JSON.stringify(page1Table);
  input["footer_0"] = JSON.stringify(footerConfig);

  // Pages 2+
  for (let p = 1; p < totalPages; p++) {
    const contHeader: PageHeaderConfig = {
      orgName: orgData.name,
      orgDetails: "",
      docTitle: data.title.toUpperCase(),
      docMeta: `Page ${p + 1} of ${totalPages}`,
      logoData: null,
      iconData: orgData.iconData ?? null,
      documentLogoMode: "icon",
      showOrgNameOnDocuments: false,
      documentColor: docColor,
    };

    const pageTable: DataTableConfig = {
      columns,
      rows: rowChunks[p],
      documentColor: docColor,
    };

    input[`header_${p}`] = JSON.stringify(contHeader);
    input[`dataTable_${p}`] = JSON.stringify(pageTable);
    input[`footer_${p}`] = JSON.stringify(footerConfig);
  }

  // Return as single-element array — one input renders all schema pages
  return [input];
}

/**
 * Count how many summary items a report result will produce.
 */
export function countSummaryItems(result: ReportResult): number {
  let count = 0;
  if (result.aggregations) {
    for (const key of Object.keys(result.aggregations)) {
      if (key !== "totalRows") count++;
    }
  }
  return count + 1; // +1 for "Total Rows"
}

/**
 * Calculate how many rows fit on page 1 given the summary item count.
 */
function getPage1Rows(summaryItemCount: number): number {
  const summaryRows = Math.ceil(summaryItemCount / 5);
  const SUMMARY_ROW_HEIGHT_PT = 38;
  const SUMMARY_ROW_GAP_PT = 4;
  const summaryHeightPt = summaryRows * SUMMARY_ROW_HEIGHT_PT + (summaryRows - 1) * SUMMARY_ROW_GAP_PT + 8;
  const summaryHeightMm = summaryHeightPt / PT_PER_MM;
  const page1TableY = 52 + summaryHeightMm + 2;
  const page1AvailMm = PAGE_HEIGHT - MARGIN - 10 - page1TableY;
  return Math.floor((page1AvailMm * PT_PER_MM - HEADER_HEIGHT_PT) / ROW_HEIGHT_PT);
}

/**
 * Calculate how many pages are needed for the given row count.
 */
export function calculatePageCount(rowCount: number, summaryItemCount: number = 1): number {
  const p1Rows = getPage1Rows(summaryItemCount);
  if (rowCount <= p1Rows) return 1;
  return 1 + Math.ceil((rowCount - p1Rows) / PAGEN_ROWS);
}
