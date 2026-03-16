/**
 * gearflowTextBlock plugin — multi-line text content renderer.
 * Used for certificates, disclaimers, detail grids, and other text sections.
 * Supports multiple paragraphs, bold headings, and key-value grids.
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import {
  getLayoutProps, hexToRgb, getHelveticaFonts, drawWrappedText,
  stubUiRender, stubPropPanel,
} from "./helpers";

interface TextBlockSchema extends Schema {
  type: "gearflowTextBlock";
}

export interface TextBlockParagraph {
  text: string;
  bold?: boolean;
  fontSize?: number;
  color?: string;
  marginBottom?: number;
}

export interface TextBlockKeyValue {
  label: string;
  value: string;
}

export interface TextBlockConfig {
  /** Simple paragraphs */
  paragraphs?: TextBlockParagraph[];
  /** Key-value grid (rendered in columns) */
  keyValues?: TextBlockKeyValue[];
  /** Number of columns for key-value grid */
  kvColumns?: number;
  /** Section title (bold, colored) */
  title?: string;
  documentColor?: string;
  fontSize?: number;
}

export const gearflowTextBlock: Plugin<TextBlockSchema> = {
  pdf: (arg: PDFRenderProps<TextBlockSchema>) => {
    const { value, schema, pdfDoc, pdfLib, page, _cache } = arg;
    if (!value) return;

    const config: TextBlockConfig = JSON.parse(value);
    const { x, y, width } = getLayoutProps(schema, page.getHeight());
    const docColor = config.documentColor || "#0d4f4f";
    const baseFontSize = config.fontSize || 9;

    return (async () => {
      const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);
      const { regular, bold } = fonts;

      let currentY = y;

      // Section title
      if (config.title) {
        page.drawText(config.title, {
          x,
          y: currentY,
          size: 11,
          font: bold,
          color: hexToRgb(docColor, pdfLib),
        });
        // Underline
        page.drawLine({
          start: { x, y: currentY - 3 },
          end: { x: x + width, y: currentY - 3 },
          thickness: 0.5,
          color: hexToRgb("#e5e5e5", pdfLib),
        });
        currentY -= 16;
      }

      // Paragraphs
      if (config.paragraphs) {
        for (const para of config.paragraphs) {
          const fontSize = para.fontSize || baseFontSize;
          const font = para.bold ? bold : regular;
          const color = para.color || "#1a1a1a";
          const lineHeight = fontSize * 1.5;

          const consumed = drawWrappedText(page, para.text, {
            x,
            y: currentY,
            maxWidth: width,
            font,
            fontSize,
            lineHeight,
            color: hexToRgb(color, pdfLib),
          });

          currentY -= consumed + (para.marginBottom ?? 4);
        }
      }

      // Key-value grid
      if (config.keyValues?.length) {
        const cols = config.kvColumns || 3;
        const colWidth = width / cols;
        const labelFontSize = 6.5;
        const valueFontSize = 8;
        const rowHeight = 24;

        for (let i = 0; i < config.keyValues.length; i++) {
          const kv = config.keyValues[i];
          const colIdx = i % cols;
          const kvX = x + colIdx * colWidth;

          if (colIdx === 0 && i > 0) {
            currentY -= rowHeight;
          }

          // Label
          page.drawText(kv.label.toUpperCase(), {
            x: kvX,
            y: currentY,
            size: labelFontSize,
            font: regular,
            color: hexToRgb("#999999", pdfLib),
          });

          // Value
          page.drawText(kv.value || "-", {
            x: kvX,
            y: currentY - 10,
            size: valueFontSize,
            font: regular,
            color: hexToRgb("#1a1a1a", pdfLib),
          });
        }

        // Account for last row
        currentY -= rowHeight;
      }
    })();
  },
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowTextBlock",
    position: { x: 0, y: 0 },
    width: 0,
    height: 0,
    content: "",
  } as TextBlockSchema),
};
