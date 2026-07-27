import { describe, it, expect } from "vitest";
import { PDFDocument } from "@pdfme/pdf-lib";
import * as pdfLib from "@pdfme/pdf-lib";
import gearflowRichText from "./gearflow-rich-text";
import { wrapRichText, getHelveticaFonts } from "./helpers";

interface DrawTextCall {
  text: string;
  x: number;
  y: number;
  fontName: string;
}

async function runRichTextPlugin(
  value: string,
  overrides: { width?: number; fontSize?: number } = {},
): Promise<DrawTextCall[]> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);

  const calls: DrawTextCall[] = [];
  page.drawText = ((text: string, opts: Record<string, unknown>) => {
    calls.push({
      text,
      x: opts.x as number,
      y: opts.y as number,
      fontName: (opts.font as { name: string }).name,
    });
  }) as typeof page.drawText;

  const schema = {
    name: "rich",
    type: "gearflowRichText" as const,
    position: { x: 0, y: 0 },
    width: overrides.width ?? 80,
    height: 40,
    fontSize: overrides.fontSize,
  };

  await gearflowRichText.pdf({
    schema,
    page,
    pdfLib,
    pdfDoc,
    value,
    _cache: new Map<string | number, unknown>(),
    options: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return calls;
}

describe("gearflowRichText — markdown-lite rendering", () => {
  it("renders **bold** spans with the bold font", async () => {
    const calls = await runRichTextPlugin("**Karaoke Party**", { width: 200 });
    const call = calls.find((c) => c.text === "Karaoke Party");
    expect(call).toBeDefined();
    expect(call!.fontName).toBe("Helvetica-Bold");
  });

  it("renders plain text with the regular font", async () => {
    const calls = await runRichTextPlugin("Venue: Test Venue", { width: 200 });
    const call = calls.find((c) => c.text.includes("Venue"));
    expect(call!.fontName).toBe("Helvetica");
  });

  it("renders bullet lines with a bullet glyph", async () => {
    const calls = await runRichTextPlugin("- First term\n- Second term", { width: 200 });
    expect(calls.filter((c) => c.text === "• ")).toHaveLength(2);
  });

  it("word-wraps long paragraphs to fit the schema width instead of overflowing", async () => {
    const longText =
      "This is a long terms and conditions paragraph that must wrap across several lines instead of running off the edge of the page.";
    const narrowCalls = await runRichTextPlugin(longText, { width: 60 });
    const wideCalls = await runRichTextPlugin(longText, { width: 400 });

    // Wrapping produces more draw-text calls (one per wrapped line) at a
    // narrow width than at a wide one, for the same source text.
    expect(narrowCalls.length).toBeGreaterThan(wideCalls.length);
  });
});

describe("wrapRichText", () => {
  it("keeps a bold span bold across a wrap boundary", async () => {
    const pdfDoc = await PDFDocument.create();
    const fonts = await getHelveticaFonts(pdfDoc, pdfLib, new Map());
    const lines = wrapRichText("A very long line of plain text that will **definitely wrap** eventually", {
      maxWidth: 70,
      fontSize: 9,
      fonts,
    });
    expect(lines.length).toBeGreaterThan(1);
    const boldSpan = lines.flatMap((l) => l.spans).find((s) => s.style === "bold");
    expect(boldSpan).toBeDefined();
  });

  it("does not wrap when the text fits within maxWidth", async () => {
    const pdfDoc = await PDFDocument.create();
    const fonts = await getHelveticaFonts(pdfDoc, pdfLib, new Map());
    const lines = wrapRichText("Short line", { maxWidth: 400, fontSize: 9, fonts });
    expect(lines).toHaveLength(1);
  });
});
