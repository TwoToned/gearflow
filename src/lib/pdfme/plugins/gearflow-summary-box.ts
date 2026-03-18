/**
 * gearflowSummaryBox plugin — horizontal metrics summary with auto-wrapping rows.
 * Renders metric boxes in rows of up to 5, wrapping to additional rows if needed.
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import {
  getLayoutProps, hexToRgb, getHelveticaFonts,
  stubUiRender, stubPropPanel,
} from "./helpers";

interface SummaryBoxSchema extends Schema {
  type: "gearflowSummaryBox";
}

export interface SummaryBoxConfig {
  items: { label: string; value: string | number }[];
  documentColor?: string;
}

const MAX_COLS = 5;
const ROW_HEIGHT = 38; // pt per row of items
const ROW_GAP = 4; // pt gap between rows

export const gearflowSummaryBox: Plugin<SummaryBoxSchema> = {
  pdf: (arg: PDFRenderProps<SummaryBoxSchema>) => {
    const { value, schema, pdfDoc, pdfLib, page, _cache } = arg;
    if (!value) return;

    const config: SummaryBoxConfig = JSON.parse(value);
    const pageHeight = page.getHeight();
    const { x, y, width, height } = getLayoutProps(schema, pageHeight);

    return (async () => {
      const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);
      const { regular, bold } = fonts;

      const itemCount = config.items.length;
      const rowCount = Math.ceil(itemCount / MAX_COLS);
      const totalHeight = rowCount * ROW_HEIGHT + (rowCount - 1) * ROW_GAP + 8; // 4pt padding top+bottom

      // Use the top of the allocated area (getLayoutProps y is bottom)
      const topY = y + height;

      // Background box
      page.drawRectangle({
        x,
        y: topY - totalHeight,
        width,
        height: totalHeight,
        color: hexToRgb("#f9fafb", pdfLib),
        borderColor: hexToRgb("#e5e7eb", pdfLib),
        borderWidth: 0.5,
      });

      for (let i = 0; i < itemCount; i++) {
        const item = config.items[i];
        const row = Math.floor(i / MAX_COLS);
        const col = i % MAX_COLS;
        const colsInThisRow = Math.min(MAX_COLS, itemCount - row * MAX_COLS);
        const itemWidth = width / colsInThisRow;

        const centerX = x + itemWidth * col + itemWidth / 2;
        const rowTopY = topY - 4 - row * (ROW_HEIGHT + ROW_GAP);

        // Value (large, bold)
        const valStr = String(item.value);
        const valSize = 13;
        const valWidth = bold.widthOfTextAtSize(valStr, valSize);
        page.drawText(valStr, {
          x: centerX - valWidth / 2,
          y: rowTopY - 18,
          size: valSize,
          font: bold,
          color: hexToRgb("#1a1a1a", pdfLib),
        });

        // Label (small, uppercase) — truncate if too wide
        let label = item.label.toUpperCase();
        let labelSize = 6;
        let labelWidth = regular.widthOfTextAtSize(label, labelSize);
        const maxLabelWidth = itemWidth - 8; // 4pt padding each side

        if (labelWidth > maxLabelWidth) {
          // Truncate with ellipsis
          while (labelWidth > maxLabelWidth && label.length > 4) {
            label = label.slice(0, -2) + "…";
            labelWidth = regular.widthOfTextAtSize(label, labelSize);
          }
        }

        page.drawText(label, {
          x: centerX - labelWidth / 2,
          y: rowTopY - ROW_HEIGHT + 6,
          size: labelSize,
          font: regular,
          color: hexToRgb("#666666", pdfLib),
        });
      }
    })();
  },
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowSummaryBox",
    position: { x: 0, y: 0 },
    width: 0,
    height: 0,
    content: "",
  } as SummaryBoxSchema),
};
