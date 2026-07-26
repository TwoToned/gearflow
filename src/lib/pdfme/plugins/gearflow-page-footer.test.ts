import { describe, it, expect } from "vitest";
import { PDFDocument } from "@pdfme/pdf-lib";
import * as pdfLib from "@pdfme/pdf-lib";
import gearflowPageFooter from "./gearflow-page-footer";
import type { FooterConfig } from "../types";

interface DrawTextCall {
  text: string;
  x: number;
  y: number;
}

async function runFooterPlugin(config: FooterConfig): Promise<DrawTextCall[]> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);

  const drawText: DrawTextCall[] = [];
  page.drawText = ((text: string, opts: Record<string, unknown>) => {
    drawText.push({ text, x: opts.x as number, y: opts.y as number });
  }) as typeof page.drawText;
  page.drawLine = (() => {}) as typeof page.drawLine;

  const schema = {
    name: "footer",
    type: "gearflowPageFooter" as const,
    position: { x: 0, y: 0 },
    width: 170,
    height: 10,
  };

  await gearflowPageFooter.pdf({
    schema,
    page,
    pdfLib,
    pdfDoc,
    value: JSON.stringify(config),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _cache: new Map<string | number, unknown>(),
    options: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return drawText;
}

describe("gearflowPageFooter — page number", () => {
  it("does not draw a page number when config.pageNumber is absent", async () => {
    const calls = await runFooterPlugin({ text: "RVLT Flow | hello@rvlt.app" });
    expect(calls.some((c) => c.text.startsWith("Page "))).toBe(false);
  });

  it("draws 'Page X of Y' right-aligned when config.pageNumber is present", async () => {
    const calls = await runFooterPlugin({
      text: "RVLT Flow | hello@rvlt.app",
      pageNumber: "Page 2 of 4",
    });
    const pageNumCall = calls.find((c) => c.text === "Page 2 of 4");
    expect(pageNumCall).toBeDefined();
    // Right-aligned: drawn further right than the centered main text call.
    const mainCall = calls.find((c) => c.text === "RVLT Flow | hello@rvlt.app");
    expect(mainCall).toBeDefined();
    expect(pageNumCall!.x).toBeGreaterThan(mainCall!.x);
  });
});
