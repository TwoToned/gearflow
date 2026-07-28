/**
 * gearflowRichText plugin — plain multi-line text blocks (client/project
 * details, client notes, terms & conditions, system notes) with the same
 * markdown-lite formatting gearflowTable already applies to line-item notes:
 * `**bold**`, `*italic*`, and `- `/`* ` bullets. Replaces the pdfme built-in
 * `text` type for the 5 project document layouts so free-text org fields
 * (terms & conditions, client notes) and code-generated text (bolding the
 * event name in the details block) share one renderer instead of the table
 * plugin being the only markdown-aware place in the pipeline.
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import {
  getLayoutProps, hexToRgb, getHelveticaFonts, wrapRichText, drawWrappedRichLines,
  richTextLineHeight, stubUiRender, stubPropPanel,
  type RichLine, type RichTextFonts,
} from "./helpers";

interface RichTextSchema extends Schema {
  type: "gearflowRichText";
  fontSize?: number;
  fontColor?: string;
  /** Line advance in pt. Defaults to `richTextLineHeight(fontSize)` — the
   *  same formula document-composer.ts uses to reserve space for this block. */
  lineHeight?: number;
}

/**
 * Resolve the lines to draw. `raw` is either:
 *  - a JSON payload `{ lines: RichLine[] }` — pre-wrapped by
 *    document-composer.ts using real font metrics, so the exact same line
 *    breakdown drove both the page-break math AND this render (they can
 *    never disagree, and multi-page splitting slices this array directly).
 *  - a plain markdown string — the pagination engine's fallback path when it
 *    has no font metrics available (e.g. most unit tests); this plugin wraps
 *    it itself, same as before pre-wrapping existed.
 */
function resolveLines(raw: string, maxWidth: number, fontSize: number, fonts: RichTextFonts): RichLine[] {
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { lines?: unknown };
      if (Array.isArray(parsed.lines)) return parsed.lines as RichLine[];
    } catch {
      // Not JSON — fall through and treat as raw markdown text.
    }
  }
  return wrapRichText(raw, { maxWidth, fontSize, fonts });
}

async function pdfRender(arg: PDFRenderProps<RichTextSchema>) {
  const { schema, page, pdfLib, pdfDoc, _cache } = arg;
  const raw = arg.value || "";
  if (!raw) return;

  const pageHeight = page.getHeight();
  const { x, y, width, height } = getLayoutProps(schema, pageHeight);
  const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);

  const fontSize = schema.fontSize ?? 9;
  const lineHeight = schema.lineHeight ?? richTextLineHeight(fontSize);
  const color = hexToRgb(schema.fontColor || "#1a1a1a", pdfLib);

  const lines = resolveLines(raw, width, fontSize, fonts);
  if (lines.length === 0) return;

  drawWrappedRichLines(page, lines, {
    x,
    y: y + height - fontSize,
    fontSize,
    lineHeight,
    color,
    fonts,
  });
}

const gearflowRichText: Plugin<RichTextSchema> = {
  pdf: pdfRender,
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowRichText",
    position: { x: 0, y: 0 },
    width: 170,
    height: 20,
  }),
};

export default gearflowRichText;
