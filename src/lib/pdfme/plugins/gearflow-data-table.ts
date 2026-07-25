/**
 * gearflowDataTable plugin — generic configurable table for reports.
 * Handles tabular data with configurable columns, sections, badges, and expanded notes.
 * Used for T&T reports and other non-project-document tables.
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import type { PDFFont } from "@pdfme/pdf-lib";
import {
  getLayoutProps, hexToRgb, lightenHex, getHelveticaFonts,
  stubUiRender, stubPropPanel,
} from "./helpers";

interface DataTableSchema extends Schema {
  type: "gearflowDataTable";
}

export interface DataTableColumn {
  key: string;
  label: string;
  width: number; // proportional weight (not px)
  align?: "left" | "center" | "right";
  badge?: "status" | "result"; // render as colored badge
}

export interface DataTableSection {
  title: string;
  rows: Record<string, string | number | null>[];
  summary?: string; // optional summary line below section
}

export interface DataTableConfig {
  columns: DataTableColumn[];
  rows?: Record<string, string | number | null>[]; // flat rows (if no sections)
  sections?: DataTableSection[]; // grouped sections
  documentColor: string;
  showRowNumbers?: boolean;
  expandedNotes?: { rowIndex: number; text: string; bgColor?: string; textColor?: string }[];
}

// Status badge colors
const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  CURRENT: { bg: "#dcfce7", text: "#166534", label: "Current" },
  DUE_SOON: { bg: "#fef9c3", text: "#854d0e", label: "Due Soon" },
  OVERDUE: { bg: "#fee2e2", text: "#991b1b", label: "Overdue" },
  FAILED: { bg: "#fee2e2", text: "#991b1b", label: "Failed" },
  NOT_YET_TESTED: { bg: "#f3f4f6", text: "#6b7280", label: "Not Tested" },
  RETIRED: { bg: "#f3f4f6", text: "#6b7280", label: "Retired" },
};

const RESULT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  PASS: { bg: "#dcfce7", text: "#166534", label: "Pass" },
  FAIL: { bg: "#fee2e2", text: "#991b1b", label: "Fail" },
  NOT_APPLICABLE: { bg: "#f3f4f6", text: "#999999", label: "N/A" },
};

const ROW_HEIGHT = 14;
const HEADER_HEIGHT = 16;
const SECTION_HEADER_HEIGHT = 18;
const FONT_SIZE = 7;
const HEADER_FONT_SIZE = 6.5;
const CELL_PADDING = 4;

function resolveColumnWidths(columns: DataTableColumn[], totalWidth: number): number[] {
  const totalWeight = columns.reduce((sum, c) => sum + c.width, 0);
  return columns.map((c) => (c.width / totalWeight) * totalWidth);
}

export const gearflowDataTable: Plugin<DataTableSchema> = {
  pdf: (arg: PDFRenderProps<DataTableSchema>) => {
    const { value, schema, pdfDoc, pdfLib, page, _cache } = arg;
    if (!value) return;

    const config: DataTableConfig = JSON.parse(value);
    const { x, y, width } = getLayoutProps(schema, page.getHeight());

    return (async () => {
      const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);
      const { regular, bold } = fonts;
      const colWidths = resolveColumnWidths(config.columns, width);
      const docColor = hexToRgb(config.documentColor, pdfLib);
      const lightBg = lightenHex(config.documentColor, 0.92);

      let currentY = y;

      // Draw header row
      drawHeaderRow(page, config.columns, colWidths, x, currentY, bold, pdfLib, lightBg);
      currentY -= HEADER_HEIGHT;

      if (config.sections?.length) {
        // Sectioned layout
        for (const section of config.sections) {
          // Section title
          page.drawRectangle({
            x,
            y: currentY - SECTION_HEADER_HEIGHT,
            width,
            height: SECTION_HEADER_HEIGHT,
            color: hexToRgb(lightenHex(config.documentColor, 0.85), pdfLib),
          });
          page.drawText(section.title, {
            x: x + CELL_PADDING,
            y: currentY - SECTION_HEADER_HEIGHT + 5,
            size: 8,
            font: bold,
            color: docColor,
          });
          currentY -= SECTION_HEADER_HEIGHT;

          // Section rows
          currentY = drawRows(page, section.rows, config, colWidths, x, currentY, width, regular, bold, pdfLib, 0);

          if (section.summary) {
            page.drawText(section.summary, {
              x: x + CELL_PADDING,
              y: currentY - 10,
              size: 7,
              font: regular,
              color: hexToRgb("#666666", pdfLib),
            });
            currentY -= 14;
          }
        }
      } else if (config.rows) {
        currentY = drawRows(page, config.rows, config, colWidths, x, currentY, width, regular, bold, pdfLib, 0);
      }
    })();
  },
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowDataTable",
    position: { x: 0, y: 0 },
    width: 0,
    height: 0,
    content: "",
  } as DataTableSchema),
};

function drawHeaderRow(
  page: import("@pdfme/pdf-lib").PDFPage,
  columns: DataTableColumn[],
  colWidths: number[],
  x: number,
  y: number,
  boldFont: PDFFont,
  pdfLib: typeof import("@pdfme/pdf-lib"),
  bgColor: string,
) {
  page.drawRectangle({
    x,
    y: y - HEADER_HEIGHT,
    width: colWidths.reduce((a, b) => a + b, 0),
    height: HEADER_HEIGHT,
    color: hexToRgb(bgColor, pdfLib),
  });
  // Bottom border
  page.drawLine({
    start: { x, y: y - HEADER_HEIGHT },
    end: { x: x + colWidths.reduce((a, b) => a + b, 0), y: y - HEADER_HEIGHT },
    thickness: 0.5,
    color: hexToRgb("#dddddd", pdfLib),
  });

  let cellX = x;
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const w = colWidths[i];
    let textX = cellX + CELL_PADDING;
    if (col.align === "right") {
      const textWidth = boldFont.widthOfTextAtSize(col.label, HEADER_FONT_SIZE);
      textX = cellX + w - CELL_PADDING - textWidth;
    } else if (col.align === "center") {
      const textWidth = boldFont.widthOfTextAtSize(col.label, HEADER_FONT_SIZE);
      textX = cellX + (w - textWidth) / 2;
    }
    page.drawText(col.label.toUpperCase(), {
      x: textX,
      y: y - HEADER_HEIGHT + 5,
      size: HEADER_FONT_SIZE,
      font: boldFont,
      color: hexToRgb("#666666", pdfLib),
    });
    cellX += w;
  }
}

function drawRows(
  page: import("@pdfme/pdf-lib").PDFPage,
  rows: Record<string, string | number | null>[],
  config: DataTableConfig,
  colWidths: number[],
  x: number,
  startY: number,
  totalWidth: number,
  regular: PDFFont,
  bold: PDFFont,
  pdfLib: typeof import("@pdfme/pdf-lib"),
  startIndex: number,
): number {
  let currentY = startY;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const isAlt = rowIdx % 2 === 1;

    // Alt row background
    if (isAlt) {
      page.drawRectangle({
        x,
        y: currentY - ROW_HEIGHT,
        width: totalWidth,
        height: ROW_HEIGHT,
        color: hexToRgb("#fafafa", pdfLib),
      });
    }

    // Row bottom border
    page.drawLine({
      start: { x, y: currentY - ROW_HEIGHT },
      end: { x: x + totalWidth, y: currentY - ROW_HEIGHT },
      thickness: 0.3,
      color: hexToRgb("#eeeeee", pdfLib),
    });

    let cellX = x;
    for (let colIdx = 0; colIdx < config.columns.length; colIdx++) {
      const col = config.columns[colIdx];
      const w = colWidths[colIdx];
      const cellValue = String(row[col.key] ?? "-");

      if (col.badge === "status" || col.badge === "result") {
        drawBadge(page, cellValue, col.badge, cellX + CELL_PADDING, currentY - ROW_HEIGHT + 3, regular, pdfLib);
      } else {
        // Truncate text to fit column
        let displayText = cellValue;
        const maxTextWidth = w - CELL_PADDING * 2;
        if (regular.widthOfTextAtSize(displayText, FONT_SIZE) > maxTextWidth) {
          while (displayText.length > 1 && regular.widthOfTextAtSize(displayText + "...", FONT_SIZE) > maxTextWidth) {
            displayText = displayText.slice(0, -1);
          }
          displayText += "...";
        }

        let textX = cellX + CELL_PADDING;
        if (col.align === "right") {
          const tw = regular.widthOfTextAtSize(displayText, FONT_SIZE);
          textX = cellX + w - CELL_PADDING - tw;
        } else if (col.align === "center") {
          const tw = regular.widthOfTextAtSize(displayText, FONT_SIZE);
          textX = cellX + (w - tw) / 2;
        }

        page.drawText(displayText, {
          x: textX,
          y: currentY - ROW_HEIGHT + 4,
          size: FONT_SIZE,
          font: regular,
          color: hexToRgb("#1a1a1a", pdfLib),
        });
      }

      cellX += w;
    }

    currentY -= ROW_HEIGHT;

    // Check for expanded notes
    if (config.expandedNotes) {
      const note = config.expandedNotes.find((n) => n.rowIndex === startIndex + rowIdx);
      if (note) {
        const noteBg = note.bgColor || "#fff5f5";
        const noteColor = note.textColor || "#991b1b";
        page.drawRectangle({
          x,
          y: currentY - ROW_HEIGHT,
          width: totalWidth,
          height: ROW_HEIGHT,
          color: hexToRgb(noteBg, pdfLib),
        });
        page.drawText(`Notes: ${note.text}`, {
          x: x + CELL_PADDING + 8,
          y: currentY - ROW_HEIGHT + 4,
          size: 6.5,
          font: regular,
          color: hexToRgb(noteColor, pdfLib),
        });
        currentY -= ROW_HEIGHT;
      }
    }
  }

  return currentY;
}

function drawBadge(
  page: import("@pdfme/pdf-lib").PDFPage,
  value: string,
  type: "status" | "result",
  x: number,
  y: number,
  font: PDFFont,
  pdfLib: typeof import("@pdfme/pdf-lib"),
) {
  const lookup = type === "status" ? STATUS_COLORS : RESULT_COLORS;
  const style = lookup[value] || { bg: "#f3f4f6", text: "#6b7280", label: value };
  const label = style.label;
  const textWidth = font.widthOfTextAtSize(label, 6.5);
  const badgeWidth = textWidth + 6;
  const badgeHeight = 9;

  page.drawRectangle({
    x,
    y,
    width: badgeWidth,
    height: badgeHeight,
    color: hexToRgb(style.bg, pdfLib),
    borderColor: hexToRgb(style.bg, pdfLib),
    borderWidth: 0,
  });
  page.drawText(label, {
    x: x + 3,
    y: y + 2,
    size: 6.5,
    font,
    color: hexToRgb(style.text, pdfLib),
  });
}
