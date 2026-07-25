/**
 * gearflowFinancialSummary plugin — renders the financial totals block.
 * Subtotal, Discount (conditional), Tax, Total (bold with divider), Deposit, Balance Due.
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import { getLayoutProps, hexToRgb, getHelveticaFonts, formatCurrency, stubUiRender, stubPropPanel } from "./helpers";
import type { FinancialSummaryConfig } from "../types";

interface FinancialSummarySchema extends Schema {
  type: "gearflowFinancialSummary";
}

async function pdfRender(arg: PDFRenderProps<FinancialSummarySchema>) {
  const { schema, page, pdfLib, pdfDoc, _cache } = arg;
  const value = arg.value || "{}";
  const config = JSON.parse(value) as FinancialSummaryConfig;

  const pageHeight = page.getHeight();
  const { x, y, width, height } = getLayoutProps(schema, pageHeight);
  const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);

  const labelColor = hexToRgb("#666666", pdfLib);
  const textColor = hexToRgb("#1a1a1a", pdfLib);
  const docColor = hexToRgb(config.documentColor || "#0d4f4f", pdfLib);

  // Right-aligned totals block
  const blockWidth = 200;
  const blockX = x + width - blockWidth;

  let currentY = y + height;
  const rowHeight = 14;

  function drawRow(label: string, value: string, opts?: { bold?: boolean; divider?: boolean; fontSize?: number }) {
    const fontSize = opts?.fontSize || 9;

    if (opts?.divider) {
      // Draw divider line
      page.drawLine({
        start: { x: blockX, y: currentY + 2 },
        end: { x: blockX + blockWidth, y: currentY + 2 },
        thickness: 1,
        color: docColor,
      });
      currentY -= 4;
    }

    // Label
    page.drawText(label, {
      x: blockX,
      y: currentY,
      size: fontSize,
      font: opts?.bold ? fonts.bold : fonts.regular,
      color: opts?.bold ? textColor : labelColor,
    });

    // Value (right-aligned)
    const valueFont = opts?.bold ? fonts.bold : fonts.regular;
    const valueFontSize = opts?.bold ? 11 : fontSize;
    const valueTextWidth = valueFont.widthOfTextAtSize(value, valueFontSize);
    page.drawText(value, {
      x: blockX + blockWidth - valueTextWidth,
      y: currentY,
      size: valueFontSize,
      font: valueFont,
      color: textColor,
    });

    currentY -= rowHeight;
  }

  // Subtotal
  drawRow("Subtotal", formatCurrency(config.subtotal));

  // Discount (only if > 0)
  if (config.discountAmount > 0) {
    const discountLabel = config.discountPercent
      ? `Discount (${config.discountPercent}%)`
      : "Discount";
    drawRow(discountLabel, `-${formatCurrency(config.discountAmount)}`);
  }

  // Tax
  drawRow(config.taxLabel || "GST", formatCurrency(config.taxAmount));

  // Total (bold with divider)
  drawRow("Total", formatCurrency(config.total), { bold: true, divider: true, fontSize: 11 });

  // Deposit Paid (only if > 0)
  if (config.depositPaid > 0) {
    drawRow("Deposit Paid", `-${formatCurrency(config.depositPaid)}`);
    drawRow("Balance Due", formatCurrency(config.balanceDue), { bold: true });
  }
}

const gearflowFinancialSummary: Plugin<FinancialSummarySchema> = {
  pdf: pdfRender,
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowFinancialSummary",
    position: { x: 0, y: 0 },
    width: 170,
    height: 25,
  }),
};

export default gearflowFinancialSummary;
