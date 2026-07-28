import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "@pdfme/pdf-lib";
import * as pdfLib from "@pdfme/pdf-lib";
import gearflowFinancialSummary from "./gearflow-financial-summary";
import type { FinancialSummaryConfig } from "../types";

interface DrawTextCall {
  text: string;
  x: number;
  y: number;
  fontName: string;
}
interface DrawLineCall {
  startY: number;
  endY: number;
}

const BASE_CONFIG: FinancialSummaryConfig = {
  subtotal: 295,
  itemDiscountTotal: 0,
  discountPercent: 0,
  discountAmount: 0,
  taxLabel: "GST",
  taxAmount: 29.5,
  total: 324.5,
  depositPaid: 0,
  balanceDue: 0,
  documentColor: "#0d4f4f",
};

async function runFinancialSummaryPlugin(
  config: FinancialSummaryConfig,
): Promise<{ drawText: DrawTextCall[]; drawLine: DrawLineCall[] }> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);

  const drawText: DrawTextCall[] = [];
  const drawLine: DrawLineCall[] = [];
  page.drawText = ((text: string, opts: Record<string, unknown>) => {
    drawText.push({
      text,
      x: opts.x as number,
      y: opts.y as number,
      fontName: (opts.font as { name: string }).name,
    });
  }) as typeof page.drawText;
  page.drawLine = ((opts: { start: { y: number }; end: { y: number } }) => {
    drawLine.push({ startY: opts.start.y, endY: opts.end.y });
  }) as typeof page.drawLine;

  const schema = {
    name: "totals",
    type: "gearflowFinancialSummary" as const,
    position: { x: 0, y: 0 },
    width: 210,
    height: 40,
  };

  await gearflowFinancialSummary.pdf({
    schema,
    page,
    pdfLib,
    pdfDoc,
    value: JSON.stringify(config),
    _cache: new Map<string | number, unknown>(),
    options: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return { drawText, drawLine };
}

describe("gearflowFinancialSummary — Total divider clearance", () => {
  it("draws the divider line clear of both the row above and the Total text (no overlap)", async () => {
    const { drawText, drawLine } = await runFinancialSummaryPlugin(BASE_CONFIG);

    const gstCall = drawText.find((c) => c.text === "GST");
    const totalCall = drawText.find((c) => c.text === "Total");
    expect(gstCall).toBeDefined();
    expect(totalCall).toBeDefined();
    expect(drawLine).toHaveLength(1);
    const line = drawLine[0];

    // Line sits strictly between the GST row's baseline and the Total row's
    // baseline (pdf-lib y increases upward): GST baseline > line y > Total baseline.
    expect(line.startY).toBeLessThan(gstCall!.y);
    expect(line.startY).toBeGreaterThan(totalCall!.y);

    // Total's bold size-11 text must not reach up to the line — the actual
    // regression this test guards against. Uses the real embedded font's
    // ascent (pdf-lib heightAtSize, no descender), not a guessed constant.
    const metricsDoc = await PDFDocument.create();
    const boldFont = await metricsDoc.embedFont(StandardFonts.HelveticaBold);
    const ascent = boldFont.heightAtSize(11, { descender: false });
    expect(totalCall!.y + ascent).toBeLessThan(line.startY);
  });
});

describe("gearflowFinancialSummary — item discount transparency rows", () => {
  it("adds no extra rows when itemDiscountTotal is 0", async () => {
    const { drawText } = await runFinancialSummaryPlugin(BASE_CONFIG);
    expect(drawText.some((c) => c.text === "Item Discounts")).toBe(false);
    expect(drawText.some((c) => c.text.startsWith("Subtotal (before discounts)"))).toBe(false);
  });

  it("shows gross subtotal + item discounts above the existing net subtotal, without changing Total", async () => {
    const config: FinancialSummaryConfig = { ...BASE_CONFIG, itemDiscountTotal: 50 };
    const { drawText } = await runFinancialSummaryPlugin(config);

    expect(drawText.some((c) => c.text === "Subtotal (before discounts)")).toBe(true);
    expect(drawText.some((c) => c.text === "Item Discounts")).toBe(true);
    // Gross = net subtotal + itemDiscountTotal = 295 + 50 = 345.
    expect(drawText.some((c) => c.text === "$345.00")).toBe(true);
    expect(drawText.some((c) => c.text === "-$50.00")).toBe(true);
    // The real net Subtotal row is untouched — no double subtraction.
    expect(drawText.some((c) => c.text === "Subtotal")).toBe(true);
    expect(drawText.some((c) => c.text === "$295.00")).toBe(true);
    expect(drawText.some((c) => c.text === "$324.50")).toBe(true); // Total unchanged
  });
});
