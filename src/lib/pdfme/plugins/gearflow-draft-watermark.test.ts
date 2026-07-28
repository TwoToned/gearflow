import { describe, it, expect } from "vitest";
import { PDFDocument } from "@pdfme/pdf-lib";
import * as pdfLib from "@pdfme/pdf-lib";
import gearflowDraftWatermark from "./gearflow-draft-watermark";
import type { DraftWatermarkConfig } from "../types";

/**
 * The draft-preview banner actually draws (#987). Two things matter beyond
 * "it doesn't crash": the words a client would see, and the em dash — pdfme is
 * Helvetica-only (CLAUDE.md), and Helvetica cannot encode `—`, so an unfiltered
 * title would throw at render time on the one document type whose entire job is
 * to be unmistakable.
 */

interface DrawTextCall {
  text: string;
  x: number;
  y: number;
  size: number;
}

async function runWatermark(config: Partial<DraftWatermarkConfig>): Promise<{
  texts: DrawTextCall[];
  rectangles: number;
}> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);

  const texts: DrawTextCall[] = [];
  let rectangles = 0;
  page.drawText = ((text: string, opts: Record<string, unknown>) => {
    // Encoding the string is what would throw on an em dash — do it for real,
    // exactly as pdf-lib would when the page is serialised.
    font.encodeText(text);
    texts.push({ text, x: opts.x as number, y: opts.y as number, size: opts.size as number });
  }) as typeof page.drawText;
  page.drawRectangle = (() => {
    rectangles++;
  }) as typeof page.drawRectangle;

  await gearflowDraftWatermark.pdf({
    schema: { name: "wm", type: "gearflowDraftWatermark" as const, position: { x: 10, y: 10 }, width: 170, height: 14 },
    page,
    pdfLib,
    pdfDoc,
    value: JSON.stringify(config),
    _cache: new Map<string | number, unknown>(),
    options: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return { texts, rectangles };
}

describe("gearflowDraftWatermark", () => {
  it("draws the banner box plus the title and subtitle", async () => {
    const { texts, rectangles } = await runWatermark({
      title: "DRAFT PREVIEW - NOT SENT",
      subtitle: "Live pricing, not frozen.",
    });

    expect(rectangles).toBe(1);
    expect(texts.map((t) => t.text)).toEqual(["DRAFT PREVIEW - NOT SENT", "Live pricing, not frozen."]);
    // The title has to dominate — it is the whole point of the block.
    expect(texts[0].size).toBeGreaterThan(texts[1].size);
  });

  it("renders an em-dash title without throwing (Helvetica can't encode it)", async () => {
    const { texts } = await runWatermark({ title: "DRAFT PREVIEW — NOT SENT", subtitle: "" });

    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe("DRAFT PREVIEW - NOT SENT");
  });

  it("falls back to the standard warning when handed nothing", async () => {
    const { texts } = await runWatermark({});

    expect(texts[0].text).toContain("NOT SENT");
  });
});
