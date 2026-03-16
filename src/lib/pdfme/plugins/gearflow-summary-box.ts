/**
 * gearflowSummaryBox plugin — horizontal metrics summary row.
 * Renders a row of metric boxes (e.g., "Total: 42", "Compliance: 95%").
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

export const gearflowSummaryBox: Plugin<SummaryBoxSchema> = {
  pdf: (arg: PDFRenderProps<SummaryBoxSchema>) => {
    const { value, schema, pdfDoc, pdfLib, page, _cache } = arg;
    if (!value) return;

    const config: SummaryBoxConfig = JSON.parse(value);
    const { x, y, width, height } = getLayoutProps(schema, page.getHeight());

    return (async () => {
      const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);
      const { regular, bold } = fonts;

      // Background box
      page.drawRectangle({
        x,
        y: y,
        width,
        height,
        color: hexToRgb("#f9fafb", pdfLib),
        borderColor: hexToRgb("#e5e7eb", pdfLib),
        borderWidth: 0.5,
      });

      const itemCount = config.items.length;
      const itemWidth = width / itemCount;

      for (let i = 0; i < itemCount; i++) {
        const item = config.items[i];
        const centerX = x + itemWidth * i + itemWidth / 2;

        // Value (large, bold)
        const valStr = String(item.value);
        const valWidth = bold.widthOfTextAtSize(valStr, 13);
        page.drawText(valStr, {
          x: centerX - valWidth / 2,
          y: y + height / 2 - 2,
          size: 13,
          font: bold,
          color: hexToRgb("#1a1a1a", pdfLib),
        });

        // Label (small, uppercase)
        const label = item.label.toUpperCase();
        const labelWidth = regular.widthOfTextAtSize(label, 6);
        page.drawText(label, {
          x: centerX - labelWidth / 2,
          y: y + 4,
          size: 6,
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
