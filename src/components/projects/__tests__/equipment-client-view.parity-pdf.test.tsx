/**
 * UX unification §13 gate, PDF half: the quote PDF prints every one of the
 * table-model rows the Client view renders (see the view half,
 * `equipment-client-view.parity.test.tsx`), in the same order, and none of the
 * lines it must never print. Node environment: the PDF text extractor returns
 * nothing under jsdom.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { QuoteDocument } from "@/lib/react-pdf/quote-document";
import { renderPdfPages } from "@/lib/react-pdf/pdf-test-utils";
import { makeSpikeData } from "@/lib/react-pdf/fixture";
import { clientViewOf, modelTuples, NEVER_PRINTED, quoteLineItems } from "./client-view-parity.fixture";

describe("Client view parity (PDF half)", () => {
  const items = quoteLineItems();
  const tuples = modelTuples(clientViewOf(items));
  let pdfText = "";
  beforeAll(async () => {
    pdfText = (await renderPdfPages(<QuoteDocument data={makeSpikeData({ line_items: items })} />)).fullText;
  });

  it("prints every row's section, rollup, name, cells and disclosed members, in order", () => {
    let cursor = 0;
    for (const [section, rollup, name, qty, unit, discount, total, members] of tuples) {
      if (section) expect(pdfText, `section "${section}"`).toContain(section);
      if (rollup) expect(pdfText, `rollup "${rollup}"`).toContain(rollup);
      const at = pdfText.indexOf(name, cursor);
      expect(at, `"${name}" missing or out of order`).toBeGreaterThanOrEqual(0);
      cursor = at;
      // The row's own cells follow its name on the page.
      const tail = pdfText.slice(at, at + name.length + 200);
      for (const cell of [qty, unit, discount, total].filter((c) => c && c !== "-")) {
        expect(tail, `"${name}" cell "${cell}"`).toContain(cell);
      }
      for (const member of members ? members.split(",") : []) {
        expect(tail, `"${name}" member "${member}"`).toContain(member.split("×")[0]);
      }
    }
  });

  it("never prints a line the Client view never shows", () => {
    for (const hidden of NEVER_PRINTED) expect(pdfText, hidden).not.toContain(hidden);
  });
});
