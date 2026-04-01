/**
 * Day Header plugin — visual day separator for multi-day call sheets.
 * Shows date label, phase badges, and crew count.
 * Left accent bar in document color.
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import { getLayoutProps, hexToRgb, getHelveticaFonts, stubUiRender, stubPropPanel } from "./helpers";

export interface DayHeaderConfig {
  dayLabel: string;
  phases: string[];
  crewCount: number;
  documentColor: string;
}

const defaultSchema: Schema = {
  name: "dayHeader",
  type: "gearflowDayHeader",
  content: "",
  position: { x: 0, y: 0 },
  width: 269,
  height: 18,
};

const gearflowDayHeader: Plugin<Schema> = {
  ui: stubUiRender(),
  pdf: async (arg) => {
    const { schema, page, pdfLib, pdfDoc, _cache, value } = arg as PDFRenderProps<Schema>;

    if (!value) return;

    let config: DayHeaderConfig;
    try {
      config = JSON.parse(value);
    } catch {
      return;
    }

    const pageHeight = page.getHeight();
    const { x, y, width, height } = getLayoutProps(schema, pageHeight);
    const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);

    const accentColor = hexToRgb(config.documentColor || "#0d4f4f", pdfLib);
    const textColor = hexToRgb("#1a1a1a", pdfLib);
    const dimColor = hexToRgb("#888888", pdfLib);
    const borderColor = hexToRgb("#cccccc", pdfLib);
    const bgColor = hexToRgb("#f8f8f8", pdfLib);

    // Top separator line (clear visual break between days)
    const topLineY = y + height;
    page.drawLine({
      start: { x, y: topLineY },
      end: { x: x + width, y: topLineY },
      thickness: 1,
      color: borderColor,
    });

    // Background fill for the header block
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: bgColor,
    });

    // Left accent bar (4mm wide, full height)
    const barWidth = 10; // ~4mm in pt
    page.drawRectangle({
      x,
      y,
      width: barWidth,
      height,
      color: accentColor,
    });

    // Day label — bold, 14pt
    const labelSize = 14;
    const labelX = x + barWidth + 8;
    const labelY = y + height / 2 - labelSize / 2;
    page.drawText(config.dayLabel, {
      x: labelX,
      y: labelY,
      size: labelSize,
      font: fonts.bold,
      color: textColor,
    });

    // Phase badges + crew count — right-aligned, 8pt
    const badgeSize = 8;
    const rightParts: string[] = [];

    if (config.phases && config.phases.length > 0) {
      const phaseLabels = config.phases.map(p =>
        p.replace(/_/g, " ")
      );
      rightParts.push(phaseLabels.join(" | "));
    }

    if (config.crewCount !== undefined) {
      rightParts.push(`${config.crewCount} ${config.crewCount === 1 ? "person" : "people"}`);
    }

    if (rightParts.length > 0) {
      const rightText = rightParts.join("  \u2022  ");
      const rightWidth = fonts.regular.widthOfTextAtSize(rightText, badgeSize);
      page.drawText(rightText, {
        x: x + width - rightWidth - 4,
        y: labelY + 2,
        size: badgeSize,
        font: fonts.regular,
        color: dimColor,
      });
    }

    // Bottom border
    page.drawLine({
      start: { x, y },
      end: { x: x + width, y },
      thickness: 1,
      color: borderColor,
    });
  },
  propPanel: stubPropPanel(defaultSchema),
};

export default gearflowDayHeader;
