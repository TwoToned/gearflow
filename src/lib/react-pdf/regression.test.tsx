/**
 * #1155 — the standing regression harness for the react-pdf pipeline,
 * mirroring `document-composer.test.ts`'s role for the old pdfme pipeline
 * (that file's own docstring already calls itself "the regression harness
 * for the new engine" — this file is what makes that literally true for
 * react-pdf). Ports its pagination invariants across all 5 doc types using
 * `pdf-parse`'s page-wise text extraction (`pdf-test-utils.ts`) instead of
 * inspecting composed pdfme schemas, which no longer exist in this pipeline.
 *
 * Scope note: some invariants this file's sibling issue (#1155) asks for are
 * geometric, not textual — "a row is never split mid-page" and "a group
 * header never strands alone at a page bottom" are guaranteed by
 * `wrap={false}` / `minPresenceAhead` (see `line-items-table.tsx`'s header
 * comment and `GroupHeaderRow`), not something a text-extraction test can
 * independently re-prove without page geometry. What IS provable from text
 * — and is the actual bug class #1149 was — is "did every item's content
 * end up somewhere in the rendered output," which is what most of this file
 * checks. Where a structural guarantee is the real proof, the test below
 * says so rather than faking a text-based check that wouldn't fail if the
 * guarantee broke.
 */
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { DOCUMENT_LAYOUTS } from "@/lib/pdfme/document-layouts";
import type { ProjectDocumentType } from "@/lib/pdfme/document-layouts";
import type { DocumentData } from "@/lib/pdfme/types";
import { QuoteDocument } from "./quote-document";
import { InvoiceDocument } from "./invoice-document";
import { PackingListDocument } from "./packing-list-document";
import { ReturnSheetDocument } from "./return-sheet-document";
import { DeliveryDocketDocument } from "./delivery-docket-document";
import { renderPdfPages } from "./pdf-test-utils";
import { makeSpikeData, makeLongLineItemList, makeNoTailDropFixture, makeTrailingGroupFixture, makeLongSingleGroupFixture } from "./fixture";

const PROJECT_DOC_TYPES = Object.keys(DOCUMENT_LAYOUTS) as ProjectDocumentType[];

type PdfElement = Parameters<typeof renderToBuffer>[0];

const DOC_COMPONENTS: Record<ProjectDocumentType, (data: DocumentData) => PdfElement> = {
  quote: (data) => <QuoteDocument data={data} />,
  invoice: (data) => <InvoiceDocument data={data} />,
  "packing-list": (data) => <PackingListDocument data={data} />,
  "return-sheet": (data) => <ReturnSheetDocument data={data} />,
  "delivery-docket": (data) => <DeliveryDocketDocument data={data} />,
};

const DOC_TITLES: Record<ProjectDocumentType, string> = {
  quote: "QUOTE",
  invoice: "TAX INVOICE",
  "packing-list": "PULL SLIP",
  "return-sheet": "RETURN SHEET",
  "delivery-docket": "DELIVERY DOCKET",
};

const PAGE_OF_PATTERN = /Page \d+ of \d+/;

// ─── No tail-drop, all 5 doc types ─────────────────────────────────────────

describe.each(PROJECT_DOC_TYPES)("no tail-drop regression (#1149 class) — %s", (docType) => {
  it("every top-level item's text appears somewhere in the rendered document", async () => {
    const items = makeNoTailDropFixture(120);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const { pageCount, fullText } = await renderPdfPages(DOC_COMPONENTS[docType](data));

    expect(pageCount).toBeGreaterThan(1);
    for (const item of items) {
      expect(fullText, `missing ${item.description} in rendered ${docType}`).toContain(item.description as string);
    }
  });
});

// ─── The #1149 case specifically ───────────────────────────────────────────

describe("#1149 regression — trailing group of varied-content rows", () => {
  it.each(PROJECT_DOC_TYPES)("every row in the trailing group renders — %s", async (docType) => {
    const { items, paddingNames, servicesNames } = makeTrailingGroupFixture();
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const { pageCount, fullText } = await renderPdfPages(DOC_COMPONENTS[docType](data));

    expect(pageCount).toBeGreaterThan(1); // actually paginates — the padding group's job
    for (const name of paddingNames) {
      expect(fullText, `missing padding row ${name}`).toContain(name);
    }
    for (const name of servicesNames) {
      expect(fullText, `missing trailing-group row ${name} (the #1149 shape)`).toContain(name);
    }
  });
});

// ─── Group header prints exactly once across a multi-page group ───────────

describe.each(PROJECT_DOC_TYPES)("group header repetition — %s", (docType) => {
  it("a single group spanning multiple pages draws its header exactly once, and every row renders", async () => {
    const { items, groupName } = makeLongSingleGroupFixture(100);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const { pageCount, fullText } = await renderPdfPages(DOC_COMPONENTS[docType](data));

    expect(pageCount).toBeGreaterThan(1);
    const headerOccurrences = fullText.split(groupName).length - 1;
    expect(headerOccurrences, `"${groupName}" should print once, not once per continuation page`).toBe(1);
    for (const item of items) {
      expect(fullText).toContain(item.description as string);
    }
  });
});

// ─── Header repeats every page, footer every page, Page X of Y ────────────

describe.each(PROJECT_DOC_TYPES)("header/footer page furniture — %s", (docType) => {
  it("repeats the doc title on every page of a multi-page document", async () => {
    const items = makeLongLineItemList(60);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const { pageCount, pages } = await renderPdfPages(DOC_COMPONENTS[docType](data));

    expect(pageCount).toBeGreaterThan(1);
    for (const [i, pageText] of pages.entries()) {
      expect(pageText, `page ${i + 1} missing doc title`).toContain(DOC_TITLES[docType]);
    }
  });

  it("repeats the footer text on every page and prints correct Page X of Y", async () => {
    const items = makeLongLineItemList(60);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const { pageCount, pages } = await renderPdfPages(DOC_COMPONENTS[docType](data));

    expect(pageCount).toBeGreaterThan(1);
    for (const [i, pageText] of pages.entries()) {
      expect(pageText, `page ${i + 1} missing org footer text`).toContain(data.org_name);
      expect(pageText, `page ${i + 1} missing "Page N of M"`).toContain(`Page ${i + 1} of ${pageCount}`);
    }
  });

  it("omits Page X of Y entirely on a single-page document", async () => {
    const data = makeSpikeData({ line_items: [], total_items: 0, terms_and_conditions: "" });
    const { pageCount, fullText } = await renderPdfPages(DOC_COMPONENTS[docType](data));

    expect(pageCount).toBe(1);
    expect(fullText).not.toMatch(PAGE_OF_PATTERN);
  });
});

// ─── Draft-preview watermark (quote/invoice only) ──────────────────────────

describe.each(["quote", "invoice"] as const)("draft-preview watermark — %s", (docType) => {
  const Component = docType === "quote" ? QuoteDocument : InvoiceDocument;
  const WATERMARK_TITLE = "DRAFT PREVIEW";

  it("repeats the watermark on every page when draftPreview is set", async () => {
    const items = makeLongLineItemList(60);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const { pageCount, pages } = await renderPdfPages(<Component data={data} draftPreview />);

    expect(pageCount).toBeGreaterThan(1);
    for (const [i, pageText] of pages.entries()) {
      expect(pageText, `page ${i + 1} missing draft watermark`).toContain(WATERMARK_TITLE);
    }
  });

  it("never shows the watermark on a stored (non-preview) render", async () => {
    const items = makeLongLineItemList(60);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const { fullText } = await renderPdfPages(<Component data={data} draftPreview={false} />);

    expect(fullText).not.toContain(WATERMARK_TITLE);
  });
});

// ─── termsAndConditions.forceNewPage (quote/invoice only) ──────────────────

// #1157 (cleanup) — was derived from DOCUMENT_LAYOUTS[docType].blocks (the
// old pdfme-composer layout registry, deleted with #1156's cutover). Only
// QuoteDocument/InvoiceDocument render a T&Cs block at all (see their own
// component trees) — hardcode the same two doc types directly.
const DOC_TYPES_WITH_TERMS: ProjectDocumentType[] = ["quote", "invoice"];

describe.each(DOC_TYPES_WITH_TERMS)("termsAndConditions forceNewPage — %s", (docType) => {
  it("terms & conditions start on their own fresh page, never sharing a page with earlier content", async () => {
    // Deliberately tiny line-item list: without forceNewPage, T&Cs would fit
    // on page 1 right after the totals block. Its presence on a LATER page
    // proves the forced break, not just that the document happened to be long.
    const data = makeSpikeData({ line_items: [], total_items: 0 }); // fixture default has terms_and_conditions set
    const { pageCount, pages } = await renderPdfPages(DOC_COMPONENTS[docType](data));

    expect(pageCount).toBe(2);
    expect(pages[0]).not.toContain("Terms & Conditions");
    expect(pages[1]).toContain("Terms & Conditions");
  });

  it("does not insert a spurious blank page when T&Cs already lands first on a fresh page", async () => {
    // A fixture sized so the table + totals already fill exactly one page,
    // so T&Cs would land first on page 2 with or without `break` — this is
    // the empirical check the #1151 spike findings doc calls out (react-pdf's
    // own splitting treats an already-out-of-bounds node as belonging to the
    // next page before `break` is ever consulted).
    const items = makeLongLineItemList(24);
    const data = makeSpikeData({ line_items: items, total_items: items.length });
    const { pageCount, pages } = await renderPdfPages(DOC_COMPONENTS[docType](data));

    const tcPageIndex = pages.findIndex((p) => p.includes("Terms & Conditions"));
    expect(tcPageIndex).toBeGreaterThan(0);
    // No page between the table's start and the T&Cs page is fully blank.
    for (let i = 0; i < tcPageIndex; i++) {
      expect(pages[i].trim().length, `page ${i + 1} is unexpectedly blank`).toBeGreaterThan(0);
    }
    expect(pageCount).toBe(tcPageIndex + 1);
  });
});
