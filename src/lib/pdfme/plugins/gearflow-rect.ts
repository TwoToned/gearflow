/**
 * gearflowRect plugin — renders a background rectangle with optional border
 * behind a content section. Used to apply BlockStyling (background color,
 * border color/width) to individual sections in the PDF.
 *
 * The plugin receives a JSON config with styling properties and draws
 * a filled/stroked rectangle at the schema position.
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import { getLayoutProps, hexToRgb, stubUiRender, stubPropPanel } from "./helpers";

export interface RectConfig {
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  /** Extra padding in mm (already accounted for in positioning) */
  padding?: number;
}

interface RectSchema extends Schema {
  type: "gearflowRect";
}

async function pdfRender(arg: PDFRenderProps<RectSchema>) {
  const { schema, page, pdfLib } = arg;
  const value = arg.value || "{}";
  const config = JSON.parse(value) as RectConfig;

  if (!config.backgroundColor && !config.borderColor) return;

  const pageHeight = page.getHeight();
  const { x, y, width, height } = getLayoutProps(schema, pageHeight);

  const drawOpts: Parameters<typeof page.drawRectangle>[0] = {
    x,
    y,
    width,
    height,
  };

  if (config.backgroundColor) {
    drawOpts.color = hexToRgb(config.backgroundColor, pdfLib);
  }

  if (config.borderColor && config.borderWidth) {
    drawOpts.borderColor = hexToRgb(config.borderColor, pdfLib);
    drawOpts.borderWidth = config.borderWidth;
  }

  page.drawRectangle(drawOpts);
}

const gearflowRect: Plugin<RectSchema> = {
  pdf: pdfRender,
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowRect",
    position: { x: 0, y: 0 },
    width: 10,
    height: 10,
  }),
};

export default gearflowRect;
