/**
 * gearflowPageFooter plugin — renders footer with centered text + top border.
 * Matches current: "{org} | {email} | {phone}\nThis quote is valid for 30 days..."
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import { getLayoutProps, hexToRgb, getHelveticaFonts, stubUiRender, stubPropPanel } from "./helpers";
import type { FooterConfig } from "../types";

interface FooterSchema extends Schema {
  type: "gearflowPageFooter";
}

async function pdfRender(arg: PDFRenderProps<FooterSchema>) {
  const { schema, page, pdfLib, pdfDoc, _cache } = arg;
  const value = arg.value || "{}";
  const config = JSON.parse(value) as FooterConfig;

  const pageHeight = page.getHeight();
  const { x, y, width, height } = getLayoutProps(schema, pageHeight);
  const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);

  const textColor = hexToRgb("#999999", pdfLib);
  const borderColor = hexToRgb("#eeeeee", pdfLib);

  // Top border line
  page.drawLine({
    start: { x, y: y + height },
    end: { x: x + width, y: y + height },
    thickness: 0.5,
    color: borderColor,
  });

  // Main text (centered)
  const text = config.text || "";
  const fontSize = 7;
  const textWidth = fonts.regular.widthOfTextAtSize(text, fontSize);
  const textX = x + (width - textWidth) / 2;

  page.drawText(text, {
    x: textX,
    y: y + height - 12,
    size: fontSize,
    font: fonts.regular,
    color: textColor,
  });

  // Second line if present
  if (config.secondLine) {
    const secondWidth = fonts.regular.widthOfTextAtSize(config.secondLine, fontSize);
    const secondX = x + (width - secondWidth) / 2;
    page.drawText(config.secondLine, {
      x: secondX,
      y: y + height - 22,
      size: fontSize,
      font: fonts.regular,
      color: textColor,
    });
  }

  // Page number (right-aligned)
  if (config.pageNumber) {
    const pageNumWidth = fonts.regular.widthOfTextAtSize(config.pageNumber, fontSize);
    page.drawText(config.pageNumber, {
      x: x + width - pageNumWidth,
      y: y + height - 12,
      size: fontSize,
      font: fonts.regular,
      color: textColor,
    });
  }
}

const gearflowPageFooter: Plugin<FooterSchema> = {
  pdf: pdfRender,
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowPageFooter",
    position: { x: 0, y: 0 },
    width: 170,
    height: 10,
  }),
};

export default gearflowPageFooter;
