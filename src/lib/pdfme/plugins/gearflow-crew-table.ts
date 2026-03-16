/**
 * gearflowCrewTable plugin — renders crew table for call sheets.
 * Columns: #, Name, Role, Phase, Call, Wrap, Phone, Notes
 * Sorted by callTime then role.
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import { getLayoutProps, hexToRgb, getHelveticaFonts, truncateText, stubUiRender, stubPropPanel } from "./helpers";
import type { CrewEntry } from "../types";

interface CrewTableSchema extends Schema {
  type: "gearflowCrewTable";
}

interface CrewTableConfig {
  crew: CrewEntry[];
  documentColor: string;
}

const PHASE_LABELS: Record<string, string> = {
  BUMP_IN: "Bump In",
  EVENT: "Event",
  BUMP_OUT: "Bump Out",
  DELIVERY: "Delivery",
  PICKUP: "Pickup",
  SETUP: "Setup",
  REHEARSAL: "Rehearsal",
  FULL_DURATION: "Full Duration",
};

async function pdfRender(arg: PDFRenderProps<CrewTableSchema>) {
  const { schema, page, pdfLib, pdfDoc, _cache } = arg;
  const value = arg.value || "{}";
  const config = JSON.parse(value) as CrewTableConfig;

  const pageHeight = page.getHeight();
  const { x, y, width, height } = getLayoutProps(schema, pageHeight);
  const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);

  const headerBg = hexToRgb("#f5f5f5", pdfLib);
  const altBg = hexToRgb("#fafafa", pdfLib);
  const borderColor = hexToRgb("#dddddd", pdfLib);
  const textColor = hexToRgb("#1a1a1a", pdfLib);
  const labelColor = hexToRgb("#666666", pdfLib);
  const dimColor = hexToRgb("#999999", pdfLib);

  // Sort by call time, then role
  const sorted = [...config.crew].sort((a, b) => {
    const timeA = a.callTime || "99:99";
    const timeB = b.callTime || "99:99";
    if (timeA !== timeB) return timeA.localeCompare(timeB);
    return (a.role || "").localeCompare(b.role || "");
  });

  // Column definitions (widths in pt)
  const cols = [
    { key: "num", label: "#", width: 20, align: "center" as const },
    { key: "name", label: "Name", flex: 2 },
    { key: "role", label: "Role", flex: 1.5 },
    { key: "phase", label: "Phase", width: 60 },
    { key: "call", label: "Call", width: 42, align: "center" as const },
    { key: "wrap", label: "Wrap", width: 42, align: "center" as const },
    { key: "phone", label: "Phone", flex: 1.2 },
    { key: "notes", label: "Notes", flex: 1.5 },
  ];

  // Resolve flex widths
  const fixedWidth = cols.reduce((sum, c) => sum + (c.width || 0), 0);
  const totalFlex = cols.reduce((sum, c) => sum + ((c as { flex?: number }).flex || 0), 0);
  const remainingWidth = width - fixedWidth;
  const resolvedCols = cols.map((c) => ({
    ...c,
    resolvedWidth: c.width || ((c as { flex?: number }).flex || 0) / totalFlex * remainingWidth,
  }));

  const fontSize = 8;
  const headerFontSize = 7;
  const rowHeight = 18;
  const headerHeight = 16;
  const padding = 4;

  let currentY = y + height;

  // Section title
  const titleText = `Crew (${sorted.length} ${sorted.length === 1 ? "person" : "people"})`;
  page.drawText(titleText, {
    x,
    y: currentY - 9,
    size: 9,
    font: fonts.bold,
    color: textColor,
  });
  currentY -= 18;

  // Table header
  page.drawRectangle({
    x,
    y: currentY - headerHeight,
    width,
    height: headerHeight,
    color: headerBg,
  });

  let colX = x;
  for (const col of resolvedCols) {
    const textX = col.align === "center"
      ? colX + col.resolvedWidth / 2 - fonts.bold.widthOfTextAtSize(col.label, headerFontSize) / 2
      : colX + padding;
    page.drawText(col.label, {
      x: textX,
      y: currentY - headerHeight + 4,
      size: headerFontSize,
      font: fonts.bold,
      color: labelColor,
    });
    colX += col.resolvedWidth;
  }
  currentY -= headerHeight;

  // Draw border under header
  page.drawLine({
    start: { x, y: currentY },
    end: { x: x + width, y: currentY },
    thickness: 0.5,
    color: borderColor,
  });

  // Rows
  for (let idx = 0; idx < sorted.length; idx++) {
    const crew = sorted[idx];
    const rowY = currentY - rowHeight;

    // Alt row background
    if (idx % 2 === 1) {
      page.drawRectangle({
        x,
        y: rowY,
        width,
        height: rowHeight,
        color: altBg,
      });
    }

    colX = x;
    const textY = rowY + 5;

    for (const col of resolvedCols) {
      let text = "";
      let font = fonts.regular;
      let color = textColor;
      let size = fontSize;

      switch (col.key) {
        case "num":
          text = String(idx + 1);
          color = dimColor;
          break;
        case "name":
          text = crew.name;
          font = fonts.bold;
          break;
        case "role":
          text = crew.role || "-";
          break;
        case "phase":
          text = crew.phase ? PHASE_LABELS[crew.phase] || crew.phase : "-";
          size = 7;
          break;
        case "call":
          text = crew.callTime || "-";
          font = fonts.bold;
          break;
        case "wrap":
          text = crew.endTime || "-";
          break;
        case "phone":
          text = crew.phone || "-";
          size = 7;
          break;
        case "notes":
          text = crew.notes || "";
          size = 7;
          break;
      }

      text = truncateText(text, font, size, col.resolvedWidth - padding * 2);

      const textX = col.align === "center"
        ? colX + col.resolvedWidth / 2 - font.widthOfTextAtSize(text, size) / 2
        : colX + padding;

      if (text) {
        page.drawText(text, {
          x: textX,
          y: textY,
          size,
          font,
          color,
        });
      }

      colX += col.resolvedWidth;
    }

    // Row bottom border
    page.drawLine({
      start: { x, y: rowY },
      end: { x: x + width, y: rowY },
      thickness: 0.25,
      color: borderColor,
    });

    currentY -= rowHeight;
  }
}

const gearflowCrewTable: Plugin<CrewTableSchema> = {
  pdf: pdfRender,
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowCrewTable",
    position: { x: 0, y: 0 },
    width: 257, // Landscape A4 minus margins
    height: 150,
  }),
};

export default gearflowCrewTable;
