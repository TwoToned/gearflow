/**
 * #1155 — shared render+extract helper for the react-pdf regression suite.
 *
 * Every other react-pdf test file in this codebase stops at "renders, no
 * throw, page-count sanity" (see quote-document.test.ts's header comment)
 * because page-count alone was the only cheaply-checkable signal available.
 * `pdf-parse`'s `getText()` returns page-wise text (`TextResult.pages`), which
 * is what actually lets a test prove "every item rendered somewhere" instead
 * of just "the page count looks plausible" — the difference between a margin
 * that reduces the CHANCE of a #1149-style tail-drop and a test that would
 * fail if one occurred.
 */
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFParse } from "pdf-parse";

export interface RenderedPdfPages {
  pageCount: number;
  /** Text of each page, in order (index 0 = page 1). */
  pages: string[];
  /** All pages' text concatenated — convenient for a plain "does X appear anywhere" check. */
  fullText: string;
}

export async function renderPdfPages(element: Parameters<typeof renderToBuffer>[0]): Promise<RenderedPdfPages> {
  const buffer = await renderToBuffer(element);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages = result.pages.map((p) => p.text);
    return { pageCount: result.total, pages, fullText: result.text };
  } finally {
    await parser.destroy();
  }
}
