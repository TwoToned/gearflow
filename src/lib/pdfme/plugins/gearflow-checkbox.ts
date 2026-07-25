/**
 * gearflowCheckbox plugin — renders an empty checkbox or a checked checkbox.
 * Replicates the current @react-pdf/renderer checkbox (bordered square with rotated lines for checkmark).
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import { getLayoutProps, hexToRgb, stubUiRender, stubPropPanel } from "./helpers";

interface CheckboxSchema extends Schema {
  type: "gearflowCheckbox";
}

async function pdfRender(arg: PDFRenderProps<CheckboxSchema>) {
  const { schema, page, pdfLib, _cache } = arg;
  const value = arg.value || "{}";
  const config = JSON.parse(value) as { checked?: boolean; size?: number };

  const pageHeight = page.getHeight();
  const { x, y } = getLayoutProps(schema, pageHeight);
  const size = config.size || 7;
  const borderColor = hexToRgb("#333333", pdfLib);
  const borderWidth = 0.75;

  // Draw box
  page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    borderColor,
    borderWidth,
  });

  // Draw checkmark if checked (two rotated lines)
  if (config.checked) {
    const lineColor = hexToRgb("#333333", pdfLib);
    // Short leg of checkmark
    const startX = x + size * 0.2;
    const startY = y + size * 0.5;
    const midX = x + size * 0.4;
    const midY = y + size * 0.2;
    const endX = x + size * 0.85;
    const endY = y + size * 0.75;

    page.drawLine({
      start: { x: startX, y: startY },
      end: { x: midX, y: midY },
      thickness: 1,
      color: lineColor,
    });
    page.drawLine({
      start: { x: midX, y: midY },
      end: { x: endX, y: endY },
      thickness: 1,
      color: lineColor,
    });
  }
}

const gearflowCheckbox: Plugin<CheckboxSchema> = {
  pdf: pdfRender,
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowCheckbox",
    position: { x: 0, y: 0 },
    width: 3,
    height: 3,
  }),
};

export default gearflowCheckbox;
