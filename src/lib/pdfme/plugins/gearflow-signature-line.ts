/**
 * gearflowSignatureLine plugin — renders signature blocks with labels and lines.
 * "Returned By: _____ Date: _____ Signature: _____"
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import { getLayoutProps, hexToRgb, getHelveticaFonts, stubUiRender, stubPropPanel } from "./helpers";
import type { SignatureLineConfig } from "../types";

interface SignatureLineSchema extends Schema {
  type: "gearflowSignatureLine";
}

async function pdfRender(arg: PDFRenderProps<SignatureLineSchema>) {
  const { schema, page, pdfLib, pdfDoc, _cache } = arg;
  const value = arg.value || "{}";
  const config = JSON.parse(value) as SignatureLineConfig;

  const pageHeight = page.getHeight();
  const { x, y, width, height } = getLayoutProps(schema, pageHeight);
  const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);

  const labelColor = hexToRgb("#999999", pdfLib);
  const lineColor = hexToRgb("#cccccc", pdfLib);
  const textColor = hexToRgb("#1a1a1a", pdfLib);

  const columns = config.columns || [
    { label: "Returned By", subLabel: "Name / Signature" },
    { label: "Received By", subLabel: "Name / Signature" },
    { label: "Date" },
  ];

  const gap = 30;
  const totalGaps = gap * (columns.length - 1);
  const colWidth = (width - totalGaps) / columns.length;

  let colX = x;
  for (const col of columns) {
    // Label
    page.drawText(col.label.toUpperCase(), {
      x: colX,
      y: y + height - 8,
      size: 7,
      font: fonts.regular,
      color: labelColor,
    });

    // Signature line
    const lineY = y + height - 38;
    page.drawLine({
      start: { x: colX, y: lineY },
      end: { x: colX + colWidth, y: lineY },
      thickness: 0.5,
      color: lineColor,
    });

    // Sub-label
    if (col.subLabel) {
      page.drawText(col.subLabel, {
        x: colX,
        y: lineY - 10,
        size: 9,
        font: fonts.regular,
        color: textColor,
      });

      // Second line for print name + signature
      const lineY2 = lineY - 30;
      page.drawLine({
        start: { x: colX, y: lineY2 },
        end: { x: colX + colWidth, y: lineY2 },
        thickness: 0.5,
        color: lineColor,
      });

      page.drawText("Signature", {
        x: colX,
        y: lineY2 - 10,
        size: 9,
        font: fonts.regular,
        color: textColor,
      });
    }

    colX += colWidth + gap;
  }
}

const gearflowSignatureLine: Plugin<SignatureLineSchema> = {
  pdf: pdfRender,
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowSignatureLine",
    position: { x: 0, y: 0 },
    width: 170,
    height: 30,
  }),
};

export default gearflowSignatureLine;
