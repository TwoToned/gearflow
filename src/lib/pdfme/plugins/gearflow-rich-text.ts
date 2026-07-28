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
import { getLayoutProps, hexToRgb, getHelveticaFonts, wrapRichText, drawWrappedRichLines, stubUiRender, stubPropPanel } from "./helpers";

interface RichTextSchema extends Schema {
  type: "gearflowRichText";
  fontSize?: number;
  fontColor?: string;
  /** Line advance in pt. Defaults to a value consistent with the ~4mm/line
   *  heuristic document-composer.ts's estimateBlockHeight uses for these
   *  same blocks. */
  lineHeight?: number;
}

async function pdfRender(arg: PDFRenderProps<RichTextSchema>) {
  const { schema, page, pdfLib, pdfDoc, _cache } = arg;
  const text = arg.value || "";
  if (!text) return;

  const pageHeight = page.getHeight();
  const { x, y, width, height } = getLayoutProps(schema, pageHeight);
  const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);

  const fontSize = schema.fontSize ?? 9;
  const lineHeight = schema.lineHeight ?? fontSize + 2.34; // ~mm2pt(4)
  const color = hexToRgb(schema.fontColor || "#1a1a1a", pdfLib);

  // Word-wrap to the box width — this block's text isn't guaranteed to fit
  // on one line per literal `\n` (e.g. a long client address or a T&Cs
  // paragraph), unlike gearflowTable's notes column.
  const lines = wrapRichText(text, { maxWidth: width, fontSize, fonts });

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
