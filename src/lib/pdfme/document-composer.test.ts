/**
 * Full-pipeline integration tests for the composer (Phase 0 safety net,
 * docs/designs/pdf-system-redesign.md). These are the regression harness for
 * the new engine: every project doc type must paginate a long equipment list
 * across pages with NO silent tail-drop (the v0.8.1.x class of bug) and
 * repeat the header on every continuation page. Pagination invariants are
 * ported from the deleted section-renderer.test.ts as this engine's spec.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "@pdfme/pdf-lib";
import * as pdfLib from "@pdfme/pdf-lib";
import { mm2pt } from "@pdfme/common";
import { composeDocument, calculateItemHeight, type ComposeResult } from "./document-composer";
import { DOCUMENT_LAYOUTS, type ProjectDocumentType } from "./document-layouts";
import { CONTENT_WIDTH, SECTION_GAP, getPageGeometry } from "./template-constants";
import { makeLineItem, runTablePlugin } from "./plugins/test-utils";
import { getHelveticaFonts, wrapRichText, type RichTextFonts } from "./plugins/helpers";
import type { DocumentData, DocumentLineItem, TablePluginConfig } from "./types";

async function makeFonts(): Promise<RichTextFonts> {
  const doc = await PDFDocument.create();
  return getHelveticaFonts(doc, pdfLib, new Map());
}

function makeData(overrides: Partial<DocumentData> = {}): DocumentData {
  return {
    org_name: "Test Org",
    org_email: "org@test.com",
    org_phone: "0400 000 000",
    org_address: "1 Test St",
    org_website: "test.com",
    org_abn: "",
    org_business_number_label: "ABN",
    org_logo: null,
    org_icon: null,
    org_tax_rate: 10,
    org_tax_label: "GST",
    org_invoice_heading: "TAX INVOICE",
    org_paper_size: "A4",
    org_branding: undefined,
    org_document_color: "#0d4f4f",
    project_number: "PRJ-001",
    project_name: "Test Project",
    project_status: "ACTIVE",
    project_type: "RENTAL",
    rental_start: "2026-03-01",
    rental_end: "2026-03-05",
    event_start: "2026-03-02",
    event_end: "2026-03-04",
    load_in_date: "2026-03-01",
    load_out_date: "2026-03-05",
    client_name: "Test Client",
    client_contact: "Jane Doe",
    client_email: "jane@client.com",
    client_phone: "0400 111 111",
    client_billing_address: "2 Client St",
    client_tax_id: "ABN 123",
    client_payment_terms: "14 days",
    venue_name: "Test Venue",
    venue_address: "3 Venue Rd",
    site_contact_name: "Site Contact",
    site_contact_phone: "0400 222 222",
    site_contact_email: "site@venue.com",
    subtotal: 10000,
    discount_percent: 10,
    discount_amount: 1000,
    tax_label: "GST",
    tax_amount: 900,
    total: 9900,
    deposit_paid: 0,
    balance_due: 9900,
    client_notes: "Handle with care.",
    crew_notes: "",
    internal_notes: "",
    document_date: "2026-07-26",
    invoice_number: "",
    document_footer_text: "",
    document_footer_second_line: "",
    terms_and_conditions: "",
    quote_valid_until: "2026-08-25",
    invoice_due_date: "",
    payment_details: "",
    line_items: [],
    pm_name: "",
    pm_phone: "",
    pm_email: "",
    load_in_time: "-",
    load_out_time: "-",
    crew: [],
    crew_by_day: [],
    equipment_summary: "No equipment assigned",
    total_items: 0,
    total_weight: 0,
    ...overrides,
  };
}

/** A long, varied equipment list: plain items, a kit with children, and a
 *  Project Group with members — enough to force pagination and exercise
 *  every height-reservation branch (kit/group/per-unit). */
function makeLongLineItemList(count: number): DocumentLineItem[] {
  const items: DocumentLineItem[] = [];

  for (let i = 0; i < count; i++) {
    items.push(
      makeLineItem({
        id: `item-${i}`,
        description: `Equipment Item ${i}`,
        quantity: (i % 5) + 1,
        checkedOutQuantity: (i % 5) + 1,
        unitPrice: 50 + i,
        lineTotal: 50 + i,
        status: "CHECKED_OUT",
        model: { name: `Model ${i}` },
        asset: (i % 5) + 1 === 1 ? { assetTag: `AST-${i}` } : null,
      }),
    );
  }

  // A kit parent with 3 children (one of which has its own accessory grandchild).
  items.push(
    makeLineItem({
      id: "kit-parent",
      description: "Lighting Kit",
      kitId: "kit-1",
      kit: { assetTag: "KIT-001", name: "Lighting Kit" },
      quantity: 1,
      checkedOutQuantity: 1,
      status: "CHECKED_OUT",
      model: { name: "Lighting Kit" },
      childLineItems: [
        makeLineItem({ id: "kit-child-1", isKitChild: true, childKind: "KIT", quantity: 2, checkedOutQuantity: 2, status: "CHECKED_OUT", model: { name: "Par Can" } }),
        makeLineItem({ id: "kit-child-2", isKitChild: true, childKind: "KIT", quantity: 1, checkedOutQuantity: 1, status: "CHECKED_OUT", model: { name: "DMX Controller" } }),
        makeLineItem({
          id: "kit-child-3",
          isKitChild: true,
          childKind: "KIT",
          quantity: 1,
          checkedOutQuantity: 1,
          status: "CHECKED_OUT",
          model: { name: "Fog Machine" },
          childLineItems: [
            makeLineItem({ id: "kit-grandchild-1", isKitChild: true, childKind: "ACCESSORY", quantity: 1, checkedOutQuantity: 1, status: "CHECKED_OUT", model: { name: "Fog Fluid" } }),
          ],
        }),
      ],
    }),
  );

  // A Project Group with 2 members.
  items.push(
    makeLineItem({
      id: "group-1",
      description: "Audio Package",
      isGroupRow: true,
      groupName: "Audio Package",
      quantity: 1,
      checkedOutQuantity: 1,
      status: "CHECKED_OUT",
      model: { name: "Audio Package" },
      childLineItems: [
        makeLineItem({ id: "group-member-1", quantity: 2, checkedOutQuantity: 2, status: "CHECKED_OUT", model: { name: "Speaker" } }),
        makeLineItem({ id: "group-member-2", quantity: 1, checkedOutQuantity: 1, status: "CHECKED_OUT", model: { name: "Mixer" } }),
      ],
    }),
  );

  return items;
}

/** Extract the gearflowTable schema's startIndex/endIndex for every page, in
 *  order. Returns null entries for pages with no table block. */
function tableRangesByPage(result: ComposeResult): Array<{ startIndex: number; endIndex: number | undefined } | null> {
  return result.template.schemas.map((pageSchemas, pageIdx) => {
    const tableSchema = pageSchemas.find((s) => s.type === "gearflowTable");
    if (!tableSchema) return null;
    const value = JSON.parse(result.inputs[0][tableSchema.name as string]) as {
      startIndex?: number;
      endIndex?: number;
    };
    return { startIndex: value.startIndex ?? 0, endIndex: value.endIndex, pageIdx };
  }) as Array<{ startIndex: number; endIndex: number | undefined } | null>;
}

/** Assert every parent-item index [0, totalParents) is covered by at least
 *  one page's [startIndex, endIndex) range — the no-tail-drop invariant. */
function assertFullCoverage(result: ComposeResult, totalParents: number) {
  const ranges = tableRangesByPage(result).filter((r): r is { startIndex: number; endIndex: number | undefined } => r !== null);
  expect(ranges.length).toBeGreaterThan(0);

  const covered = new Array(totalParents).fill(false);
  for (const { startIndex, endIndex } of ranges) {
    const end = endIndex ?? totalParents;
    for (let i = Math.max(0, startIndex); i < Math.min(end, totalParents); i++) {
      covered[i] = true;
    }
  }

  const uncoveredIndices = covered.reduce<number[]>((acc, c, i) => (c ? acc : [...acc, i]), []);
  expect(uncoveredIndices, `uncovered parent item indices: ${uncoveredIndices.join(", ")}`).toEqual([]);

  // The last page must render to the end (no artificial cap).
  const last = ranges[ranges.length - 1];
  expect(last.endIndex === undefined || last.endIndex >= totalParents).toBe(true);
}

const PROJECT_DOC_TYPES = Object.keys(DOCUMENT_LAYOUTS) as ProjectDocumentType[];

describe("composeDocument — single page smoke test (every doc type)", () => {
  for (const docType of PROJECT_DOC_TYPES) {
    it(`renders ${docType} with a header, table/content, and footer on one page`, () => {
      const data = makeData({ line_items: [makeLineItem({ id: "only-item", status: "CHECKED_OUT", checkedOutQuantity: 1, model: { name: "Solo Item" } })] });
      const result = composeDocument(docType, data, "#0d4f4f");

      expect(result.template.schemas.length).toBe(1);
      const schemas = result.template.schemas[0];
      const header = schemas.find((s) => s.type === "gearflowPageHeader");
      expect(header).toBeDefined();
      const footer = schemas.find((s) => s.type === "gearflowPageFooter");
      expect(footer).toBeDefined();

      const headerConfig = JSON.parse(result.inputs[0][header!.name as string]);
      expect(headerConfig.docTitle.length).toBeGreaterThan(0);
    });
  }
});

describe("composeDocument — long fixture pagination (no tail-drop)", () => {
  for (const docType of PROJECT_DOC_TYPES) {
    it(`${docType}: a 100+ line project renders every item across multiple pages`, () => {
      const lineItems = makeLongLineItemList(120);
      const data = makeData({ line_items: lineItems, total_items: lineItems.length });
      const result = composeDocument(docType, data, "#0d4f4f");

      // Must actually paginate — this is the bug the redesign fixes.
      expect(result.template.schemas.length).toBeGreaterThan(1);

      const layout = DOCUMENT_LAYOUTS[docType];
      const totalParents = (() => {
        // Mirror the composer's own filtering so the expected count matches
        // exactly (kit children / group children are not top-level parents).
        let items = lineItems.filter((i) => !i.isKitChild && !i.isContainerLineItem);
        if (layout.filterByStatus) {
          const statuses = layout.filterByStatus;
          items = items.filter((i) => statuses.includes(i.status));
        }
        if (docType === "delivery-docket") {
          // Kit parents are promoted to their CHECKED_OUT children as rows.
          const nonKitCount = items.filter((i) => !i.kitId).length;
          const kitChildCount = items.filter((i) => i.kitId).reduce((n, i) => n + (i.childLineItems?.filter((c) => c.status === "CHECKED_OUT").length ?? 0), 0);
          return nonKitCount + kitChildCount;
        }
        return items.length;
      })();

      assertFullCoverage(result, totalParents);

      // Header repeats on every continuation page.
      for (const pageSchemas of result.template.schemas) {
        expect(pageSchemas.some((s) => s.type === "gearflowPageHeader")).toBe(true);
        expect(pageSchemas.some((s) => s.type === "gearflowPageFooter")).toBe(true);
      }
    });
  }
});

/**
 * I5 (#1084) — the Letter-paper variant of the harness above, per the issue's
 * own instruction ("needs a Letter variant of each fixture, not a single
 * smoke test"). Letter is WIDER (more fits per line) AND SHORTER (less
 * height per page) than A4 — both dimensions have to be threaded correctly
 * through `getPageGeometry`/`PageGeometry` for this to hold. Same 120-item
 * fixture, same no-tail-drop assertion, same header/footer-repeats check;
 * only `paperSize` differs from the A4 harness above.
 */
describe("composeDocument — Letter paper long fixture pagination (I5, #1084, no tail-drop)", () => {
  for (const docType of PROJECT_DOC_TYPES) {
    it(`${docType}: a 100+ line project renders every item across multiple Letter pages`, () => {
      const lineItems = makeLongLineItemList(120);
      const data = makeData({ line_items: lineItems, total_items: lineItems.length });
      const result = composeDocument(docType, data, "#0d4f4f", undefined, undefined, "LETTER");

      // Must actually paginate — Letter's shorter page fits even less per page than A4's.
      expect(result.template.schemas.length).toBeGreaterThan(1);

      // basePdf itself must be Letter-sized, not silently still A4.
      expect(result.template.basePdf).toMatchObject({ width: 216, height: 279 });

      const layout = DOCUMENT_LAYOUTS[docType];
      const totalParents = (() => {
        let items = lineItems.filter((i) => !i.isKitChild && !i.isContainerLineItem);
        if (layout.filterByStatus) {
          const statuses = layout.filterByStatus;
          items = items.filter((i) => statuses.includes(i.status));
        }
        if (docType === "delivery-docket") {
          const nonKitCount = items.filter((i) => !i.kitId).length;
          const kitChildCount = items.filter((i) => i.kitId).reduce((n, i) => n + (i.childLineItems?.filter((c) => c.status === "CHECKED_OUT").length ?? 0), 0);
          return nonKitCount + kitChildCount;
        }
        return items.length;
      })();

      assertFullCoverage(result, totalParents);

      // Header/footer repeat on every continuation page — isPageFurniture/
      // measurePageFurniture must still reserve correctly at the new height.
      for (const pageSchemas of result.template.schemas) {
        expect(pageSchemas.some((s) => s.type === "gearflowPageHeader")).toBe(true);
        expect(pageSchemas.some((s) => s.type === "gearflowPageFooter")).toBe(true);
      }
    });
  }

  it("a Letter document reserves LESS body height per page than A4 (shorter page) — proves the height, not just the width, threaded through", () => {
    const lineItems = makeLongLineItemList(120);
    const data = makeData({ line_items: lineItems, total_items: lineItems.length });
    const a4Pages = composeDocument("quote", data, "#0d4f4f", undefined, undefined, "A4").template.schemas.length;
    const letterPages = composeDocument("quote", data, "#0d4f4f", undefined, undefined, "LETTER").template.schemas.length;
    expect(letterPages).toBeGreaterThanOrEqual(a4Pages);
  });

  it("every schema on every page stays within Letter's content bounds (x + width <= page width - margin)", () => {
    const lineItems = makeLongLineItemList(120);
    const data = makeData({ line_items: lineItems, total_items: lineItems.length });
    const geometry = getPageGeometry("LETTER");
    for (const docType of PROJECT_DOC_TYPES) {
      const result = composeDocument(docType, data, "#0d4f4f", undefined, undefined, "LETTER");
      for (const pageSchemas of result.template.schemas) {
        for (const s of pageSchemas) {
          if (s.type === "gearflowPageFooter" || !("position" in s) || !("width" in s)) continue;
          const pos = s.position as { x: number; y: number };
          const width = s.width as number;
          expect(pos.x + width).toBeLessThanOrEqual(geometry.width - geometry.margin + 0.01);
        }
      }
    }
  });
});

describe("composeDocument — layout invariants", () => {
  it("quote and invoice collapse Project Groups (expandProjectGroups: false)", () => {
    expect(DOCUMENT_LAYOUTS.quote.expandProjectGroups).toBe(false);
    expect(DOCUMENT_LAYOUTS.invoice.expandProjectGroups).toBe(false);
  });

  it("warehouse doc types expand Project Groups so packers see every serial", () => {
    expect(DOCUMENT_LAYOUTS["packing-list"].expandProjectGroups).toBe(true);
    expect(DOCUMENT_LAYOUTS["return-sheet"].expandProjectGroups).toBe(true);
    expect(DOCUMENT_LAYOUTS["delivery-docket"].expandProjectGroups).toBe(true);
  });

  it("delivery-docket and return-sheet filter by CHECKED_OUT status", () => {
    expect(DOCUMENT_LAYOUTS["delivery-docket"].filterByStatus).toEqual(["CHECKED_OUT"]);
    expect(DOCUMENT_LAYOUTS["return-sheet"].filterByStatus).toEqual(["CHECKED_OUT", "RETURNED"]);
  });

  it("quote, invoice, and packing-list have no status filter", () => {
    expect(DOCUMENT_LAYOUTS.quote.filterByStatus).toBeNull();
    expect(DOCUMENT_LAYOUTS.invoice.filterByStatus).toBeNull();
    expect(DOCUMENT_LAYOUTS["packing-list"].filterByStatus).toBeNull();
  });

  it("only quote and invoice show a totals block", () => {
    const withTotals = PROJECT_DOC_TYPES.filter((t) => DOCUMENT_LAYOUTS[t].blocks.some((b) => b.kind === "totals"));
    expect(withTotals.sort()).toEqual(["invoice", "quote"]);
  });
});

describe("composeDocument — invoice_number (WS1 #940)", () => {
  const soloData = (overrides: Partial<DocumentData> = {}) =>
    makeData({
      line_items: [makeLineItem({ id: "only-item", status: "CHECKED_OUT", checkedOutQuantity: 1, model: { name: "Solo Item" } })],
      ...overrides,
    });

  it("renders 'Invoice #: <number>' on the invoice doc type when an ISSUED invoice number is present", () => {
    const result = composeDocument("invoice", soloData({ invoice_number: "INV-2026-0001" }), "#0d4f4f");
    const projectDetailsValue = Object.values(result.inputs[0] ?? {}).find(
      (v) => typeof v === "string" && v.includes("Invoice #:"),
    );
    expect(projectDetailsValue).toContain("Invoice #: INV-2026-0001");
  });

  it("renders nothing invoice-number-related when the invoice hasn't been issued yet (empty string)", () => {
    const result = composeDocument("invoice", soloData({ invoice_number: "" }), "#0d4f4f");
    const anyInvoiceNumberText = Object.values(result.inputs[0] ?? {}).some(
      (v) => typeof v === "string" && v.includes("Invoice #:"),
    );
    expect(anyInvoiceNumberText).toBe(false);
  });

  it("other doc types never render an invoice number even if the field is populated", () => {
    const result = composeDocument("quote", soloData({ invoice_number: "INV-2026-0001" }), "#0d4f4f");
    const anyInvoiceNumberText = Object.values(result.inputs[0] ?? {}).some(
      (v) => typeof v === "string" && v.includes("Invoice #:"),
    );
    expect(anyInvoiceNumberText).toBe(false);
  });
});

describe("composeDocument — org document settings (footer, T&Cs, quote validity)", () => {
  const soloData = (overrides: Partial<DocumentData> = {}) =>
    makeData({
      line_items: [makeLineItem({ id: "only-item", status: "CHECKED_OUT", checkedOutQuantity: 1, model: { name: "Solo Item" } })],
      ...overrides,
    });

  it("uses the org's footer text when set, falling back to org contact details otherwise", () => {
    const withFooter = composeDocument("quote", soloData({ document_footer_text: "Custom footer", document_footer_second_line: "Second line" }), "#0d4f4f");
    const footerSchema = withFooter.template.schemas[0].find((s) => s.type === "gearflowPageFooter")!;
    const footerConfig = JSON.parse(withFooter.inputs[0][footerSchema.name as string]);
    expect(footerConfig.text).toBe("Custom footer");
    expect(footerConfig.secondLine).toBe("Second line");

    const withoutFooter = composeDocument("quote", soloData({ document_footer_text: "" }), "#0d4f4f");
    const footerSchema2 = withoutFooter.template.schemas[0].find((s) => s.type === "gearflowPageFooter")!;
    const footerConfig2 = JSON.parse(withoutFooter.inputs[0][footerSchema2.name as string]);
    expect(footerConfig2.text).toBe("Test Org | org@test.com | 0400 000 000");
  });

  it("omits the T&Cs block entirely when the org hasn't set any terms", () => {
    const result = composeDocument("quote", soloData({ terms_and_conditions: "" }), "#0d4f4f");
    const hasTermsSchema = result.template.schemas[0].some((s) => String(s.name).startsWith("termsAndConditions"));
    expect(hasTermsSchema).toBe(false);
  });

  it("renders the T&Cs block when the org has set terms (on its own forced-new page)", () => {
    const result = composeDocument("quote", soloData({ terms_and_conditions: "All sales final." }), "#0d4f4f");
    // termsAndConditions.forceNewPage means it never shares page 0 with the
    // table/totals/notes above it — it's on a later page.
    const termsPageIdx = result.template.schemas.findIndex((pageSchemas) =>
      pageSchemas.some((s) => String(s.name).startsWith("termsAndConditions")),
    );
    expect(termsPageIdx).toBeGreaterThan(0);
    const termsSchema = result.template.schemas[termsPageIdx].find((s) => String(s.name).startsWith("termsAndConditions"))!;
    expect(termsSchema).toBeDefined();
    expect(result.inputs[0][termsSchema.name as string]).toBe("All sales final.");
  });

  it("renders the quote expiry in the header meta (\"Expiry: <date>\"), using the real computed date — no separate bottom-of-document line", () => {
    const result = composeDocument("quote", soloData({ quote_valid_until: "2026-09-15" }), "#0d4f4f");

    const headerSchema = result.template.schemas[0].find((s) => s.type === "gearflowPageHeader")!;
    const headerConfig = JSON.parse(result.inputs[0][headerSchema.name as string]);
    expect(headerConfig.docMeta).toContain("Expiry: 2026-09-15");

    const hasValidityNoteSchema = result.template.schemas[0].some((s) => String(s.name).startsWith("quoteValidityNote"));
    expect(hasValidityNoteSchema).toBe(false);
  });

  it("invoice header never shows a quote expiry line", () => {
    const result = composeDocument("invoice", soloData({ quote_valid_until: "2026-09-15" }), "#0d4f4f");
    const headerSchema = result.template.schemas[0].find((s) => s.type === "gearflowPageHeader")!;
    const headerConfig = JSON.parse(result.inputs[0][headerSchema.name as string]);
    expect(headerConfig.docMeta).not.toContain("Expiry");
  });
});

describe("composeDocument — invoice T&Cs, payment details, ABN, due date", () => {
  const soloData = (overrides: Partial<DocumentData> = {}) =>
    makeData({
      line_items: [makeLineItem({ id: "only-item", status: "CHECKED_OUT", checkedOutQuantity: 1, model: { name: "Solo Item" } })],
      ...overrides,
    });

  it("omits the T&Cs block on the invoice when unset (same convention as the quote)", () => {
    const result = composeDocument("invoice", soloData({ terms_and_conditions: "" }), "#0d4f4f");
    const hasTermsSchema = result.template.schemas.some((page) => page.some((s) => String(s.name).startsWith("termsAndConditions")));
    expect(hasTermsSchema).toBe(false);
  });

  it("renders the T&Cs block on the invoice when the data carries text (build-document-data.ts's showTermsAndConditionsOnInvoice gate resolves upstream)", () => {
    const result = composeDocument("invoice", soloData({ terms_and_conditions: "Standard terms apply." }), "#0d4f4f");
    const termsPageIdx = result.template.schemas.findIndex((page) => page.some((s) => String(s.name).startsWith("termsAndConditions")));
    expect(termsPageIdx).toBeGreaterThanOrEqual(0);
    const termsSchema = result.template.schemas[termsPageIdx].find((s) => String(s.name).startsWith("termsAndConditions"))!;
    expect(result.inputs[0][termsSchema.name as string]).toBe("Standard terms apply.");
  });

  it("never renders a paymentDetails block on the quote, even when set (invoice-only field)", () => {
    const result = composeDocument("quote", soloData({ payment_details: "Bank: Test Bank" }), "#0d4f4f");
    const hasPaymentSchema = result.template.schemas.some((page) => page.some((s) => String(s.name).startsWith("paymentDetails")));
    expect(hasPaymentSchema).toBe(false);
  });

  it("omits the paymentDetails block on the invoice when unset", () => {
    const result = composeDocument("invoice", soloData({ payment_details: "" }), "#0d4f4f");
    const hasPaymentSchema = result.template.schemas.some((page) => page.some((s) => String(s.name).startsWith("paymentDetails")));
    expect(hasPaymentSchema).toBe(false);
  });

  it("renders the paymentDetails block on the invoice, on the same page as the totals block, directly after it", () => {
    const result = composeDocument("invoice", soloData({ payment_details: "Bank: Test Bank\nBSB: 000-000\nAcct: 12345678" }), "#0d4f4f");
    const page0 = result.template.schemas[0];
    const totalsIdx = page0.findIndex((s) => s.type === "gearflowFinancialSummary");
    const paymentIdx = page0.findIndex((s) => String(s.name).startsWith("paymentDetails"));
    expect(totalsIdx).toBeGreaterThanOrEqual(0);
    expect(paymentIdx).toBe(totalsIdx + 1);
    expect(result.inputs[0][page0[paymentIdx].name as string]).toBe("Bank: Test Bank\nBSB: 000-000\nAcct: 12345678");
  });

  it("renders the org's ABN under the address/email, on every doc type — wherever the org details block renders", () => {
    for (const docType of ["quote", "invoice", "packing-list", "return-sheet", "delivery-docket"] as const) {
      const result = composeDocument(docType, soloData({ org_abn: "12 345 678 901" }), "#0d4f4f");
      const headerSchema = result.template.schemas[0].find((s) => s.type === "gearflowPageHeader")!;
      const headerConfig = JSON.parse(result.inputs[0][headerSchema.name as string]);
      expect(headerConfig.orgDetails).toContain("ABN: 12 345 678 901");
      expect(headerConfig.orgDetails.indexOf("ABN:")).toBeGreaterThan(headerConfig.orgDetails.indexOf(soloData().org_address));
    }
  });

  it("omits the ABN line when the org hasn't set one, on every doc type", () => {
    for (const docType of ["quote", "invoice", "packing-list", "return-sheet", "delivery-docket"] as const) {
      const result = composeDocument(docType, soloData({ org_abn: "" }), "#0d4f4f");
      const headerSchema = result.template.schemas[0].find((s) => s.type === "gearflowPageHeader")!;
      const headerConfig = JSON.parse(result.inputs[0][headerSchema.name as string]);
      expect(headerConfig.orgDetails).not.toContain("ABN:");
    }
  });

  it("renders the invoice due date as a bold header highlight AND as a bold row at the bottom of the totals block", () => {
    const result = composeDocument("invoice", soloData({ invoice_due_date: "25 Aug 2026" }), "#0d4f4f");

    const headerSchema = result.template.schemas[0].find((s) => s.type === "gearflowPageHeader")!;
    const headerConfig = JSON.parse(result.inputs[0][headerSchema.name as string]);
    expect(headerConfig.highlightMeta).toBe("Due: 25 Aug 2026");

    const totalsSchema = result.template.schemas[0].find((s) => s.type === "gearflowFinancialSummary")!;
    const totalsConfig = JSON.parse(result.inputs[0][totalsSchema.name as string]);
    expect(totalsConfig.dueDate).toBe("25 Aug 2026");
  });

  it("never renders a due date highlight/row on the quote", () => {
    const result = composeDocument("quote", soloData({ invoice_due_date: "25 Aug 2026" }), "#0d4f4f");

    const headerSchema = result.template.schemas[0].find((s) => s.type === "gearflowPageHeader")!;
    const headerConfig = JSON.parse(result.inputs[0][headerSchema.name as string]);
    expect(headerConfig.highlightMeta).toBeUndefined();

    const totalsSchema = result.template.schemas[0].find((s) => s.type === "gearflowFinancialSummary")!;
    const totalsConfig = JSON.parse(result.inputs[0][totalsSchema.name as string]);
    expect(totalsConfig.dueDate).toBeUndefined();
  });
});

describe("composeDocument — country-derived labels (I4, #1083)", () => {
  const soloData = (overrides: Partial<DocumentData> = {}) =>
    makeData({
      line_items: [makeLineItem({ id: "only-item", status: "CHECKED_OUT", checkedOutQuantity: 1, model: { name: "Solo Item" } })],
      ...overrides,
    });

  it("uses the AU 'TAX INVOICE' heading and 'ABN' label by default (byte-for-byte pre-#1083 AU rendering)", () => {
    const result = composeDocument("invoice", soloData({ org_abn: "12 345 678 901" }), "#0d4f4f");
    const headerSchema = result.template.schemas[0].find((s) => s.type === "gearflowPageHeader")!;
    const headerConfig = JSON.parse(result.inputs[0][headerSchema.name as string]);
    expect(headerConfig.docTitle).toBe("TAX INVOICE");
    expect(headerConfig.orgDetails).toContain("ABN: 12 345 678 901");
  });

  it("a US org's invoice renders the generic 'INVOICE' heading, not the AU-legal 'TAX INVOICE'", () => {
    const result = composeDocument(
      "invoice",
      soloData({ org_invoice_heading: "INVOICE" }),
      "#0d4f4f",
    );
    const headerSchema = result.template.schemas[0].find((s) => s.type === "gearflowPageHeader")!;
    const headerConfig = JSON.parse(result.inputs[0][headerSchema.name as string]);
    expect(headerConfig.docTitle).toBe("INVOICE");
  });

  it("non-invoice doc types never take the org_invoice_heading override — QUOTE stays QUOTE", () => {
    const result = composeDocument("quote", soloData({ org_invoice_heading: "INVOICE" }), "#0d4f4f");
    const headerSchema = result.template.schemas[0].find((s) => s.type === "gearflowPageHeader")!;
    const headerConfig = JSON.parse(result.inputs[0][headerSchema.name as string]);
    expect(headerConfig.docTitle).toBe("QUOTE");
  });

  it("a GB org's business number renders as 'VAT number', not 'ABN' — both the org's own and the client's", () => {
    const result = composeDocument(
      "invoice",
      soloData({
        org_business_number_label: "VAT number",
        org_abn: "GB123456789",
        client_tax_id: "GB987654321",
      }),
      "#0d4f4f",
    );
    const headerSchema = result.template.schemas[0].find((s) => s.type === "gearflowPageHeader")!;
    const headerConfig = JSON.parse(result.inputs[0][headerSchema.name as string]);
    expect(headerConfig.orgDetails).toContain("VAT number: GB123456789");
    expect(headerConfig.orgDetails).not.toContain("ABN:");

    const clientColSchema = result.template.schemas[0].find((s) => String(s.name).endsWith("_client"))!;
    const clientColText = result.inputs[0][clientColSchema.name as string];
    expect(clientColText).toContain("VAT number: GB987654321");
    expect(clientColText).not.toContain("ABN:");
  });
});

describe("composeDocument — footer page numbers", () => {
  function footerConfigsFor(result: ComposeResult) {
    return result.template.schemas.map((pageSchemas, pageIdx) => {
      const footer = pageSchemas.find((s) => s.type === "gearflowPageFooter")!;
      return JSON.parse(result.inputs[0][footer.name as string]) as { pageNumber?: string };
    });
  }

  it("omits the page number on a single-page document", () => {
    const data = makeData({ line_items: [makeLineItem({ id: "only-item", status: "CHECKED_OUT", checkedOutQuantity: 1, model: { name: "Solo Item" } })] });
    const result = composeDocument("quote", data, "#0d4f4f");
    expect(result.template.schemas.length).toBe(1);

    const [footerConfig] = footerConfigsFor(result);
    expect(footerConfig.pageNumber).toBeUndefined();
  });

  it("renders 'Page X of Y' on every page of a multi-page document", () => {
    const lineItems = makeLongLineItemList(120);
    const data = makeData({ line_items: lineItems, total_items: lineItems.length });
    const result = composeDocument("quote", data, "#0d4f4f");
    const total = result.template.schemas.length;
    expect(total).toBeGreaterThan(1);

    const footerConfigs = footerConfigsFor(result);
    footerConfigs.forEach((config, pageIdx) => {
      expect(config.pageNumber).toBe(`Page ${pageIdx + 1} of ${total}`);
    });
  });
});

describe("composeDocument — quote content audit (#790 Phase 4)", () => {
  function tableItemsAndConfig(result: ComposeResult): { items: DocumentLineItem[]; config: TablePluginConfig } {
    const tableSchema = result.template.schemas[0].find((s) => s.type === "gearflowTable")!;
    return JSON.parse(result.inputs[0][tableSchema.name as string]) as { items: DocumentLineItem[]; config: TablePluginConfig };
  }

  function totalsConfig(
    result: ComposeResult,
  ): { discountAmount: number; discountPercent: number; itemDiscountTotal: number; subtotal: number } {
    const totalsSchema = result.template.schemas[0].find((s) => s.type === "gearflowFinancialSummary")!;
    return JSON.parse(result.inputs[0][totalsSchema.name as string]);
  }

  it("quote and invoice tables both hide the '/day' (or other period) price suffix; other doc types are unaffected", () => {
    const { config: quoteConfig } = tableItemsAndConfig(composeDocument("quote", makeData({ line_items: [] }), "#0d4f4f"));
    expect(quoteConfig.hidePricingPeriodSuffix).toBe(true);

    const { config: invoiceConfig } = tableItemsAndConfig(composeDocument("invoice", makeData({ line_items: [] }), "#0d4f4f"));
    expect(invoiceConfig.hidePricingPeriodSuffix).toBe(true);

    const { config: docketConfig } = tableItemsAndConfig(composeDocument("delivery-docket", makeData({ line_items: [] }), "#0d4f4f"));
    expect(docketConfig.hidePricingPeriodSuffix).toBe(false);
  });

  it("the price suffix is actually suppressed at render time on the quote and the invoice", async () => {
    const item = makeLineItem({ id: "priced", status: "CONFIRMED", unitPrice: 100, pricingType: "PER_DAY", model: { name: "Priced Item" } });
    for (const docType of ["quote", "invoice"] as const) {
      const { items, config } = tableItemsAndConfig(composeDocument(docType, makeData({ line_items: [item] }), "#0d4f4f"));
      const calls = await runTablePlugin(items, config);
      const text = calls.drawText.map((c) => c.text).join("\n");
      expect(text).not.toContain("/day");
    }
  });

  it("discount renders on the quote totals block when set", () => {
    const config = totalsConfig(composeDocument("quote", makeData({ discount_percent: 10, discount_amount: 50 }), "#0d4f4f"));
    expect(config.discountAmount).toBe(50);
    expect(config.discountPercent).toBe(10);
  });

  it("discount is zero (not rendered) when the project has none", () => {
    const config = totalsConfig(composeDocument("quote", makeData({ discount_percent: 0, discount_amount: 0 }), "#0d4f4f"));
    expect(config.discountAmount).toBe(0);
  });

  it("item notes reach the rendered quote table", async () => {
    const item = makeLineItem({ id: "noted-item", status: "CONFIRMED", notes: "Fragile — handle with care", model: { name: "Glass Case" } });
    const { items, config } = tableItemsAndConfig(composeDocument("quote", makeData({ line_items: [item] }), "#0d4f4f"));
    const calls = await runTablePlugin(items, config);
    const text = calls.drawText.map((c) => c.text).join("\n");
    expect(text).toContain("Fragile");
  });

  it("Project Group descriptions (carried as .notes) reach the rendered quote table", async () => {
    const group = makeLineItem({
      id: "group-1",
      isGroupRow: true,
      groupName: "Lighting Package",
      notes: "Includes rigging and truss",
      model: { name: "Lighting Package" },
      quantity: 1,
      status: "CONFIRMED",
    });
    const { items, config } = tableItemsAndConfig(composeDocument("quote", makeData({ line_items: [group] }), "#0d4f4f"));
    const calls = await runTablePlugin(items, config);
    const text = calls.drawText.map((c) => c.text).join("\n");
    expect(text).toContain("Includes rigging and truss");
  });

  it("the event name in the details block is bolded via markdown, and details/notes/T&Cs render through gearflowRichText", () => {
    const result = composeDocument(
      "quote",
      makeData({ project_name: "Karaoke Party", client_notes: "Handle with care.", terms_and_conditions: "Standard terms." }),
      "#0d4f4f",
    );
    const pageSchemas = result.template.schemas[0];

    const projectSchema = pageSchemas.find((s) => (s.name as string).startsWith("detailsRow_") && (s.name as string).endsWith("_project"))!;
    expect(projectSchema.type).toBe("gearflowRichText");
    expect(result.inputs[0][projectSchema.name as string]).toContain("**Karaoke Party**");

    const clientNotesSchema = pageSchemas.find((s) => (s.name as string).startsWith("clientNotes_"))!;
    expect(clientNotesSchema.type).toBe("gearflowRichText");

    // termsAndConditions.forceNewPage means it's on a later page, not page 0.
    const allSchemas = result.template.schemas.flat();
    const tcSchema = allSchemas.find((s) => (s.name as string).startsWith("termsAndConditions_"))!;
    expect(tcSchema.type).toBe("gearflowRichText");
  });

  it("the quote table gets a Discount column, and the totals block's itemDiscountTotal sums every visible line's discount", () => {
    const items = [
      makeLineItem({ id: "a", status: "CONFIRMED", model: { name: "K10.2" }, unitPrice: 50, discount: 5, lineTotal: 45 }),
      makeLineItem({ id: "b", status: "CONFIRMED", model: { name: "DM3-D" }, unitPrice: 20, discount: null, lineTotal: 20 }),
    ];
    const result = composeDocument("quote", makeData({ line_items: items, subtotal: 65 }), "#0d4f4f");

    const tableSchema = result.template.schemas[0].find((s) => s.type === "gearflowTable")!;
    const { config } = JSON.parse(result.inputs[0][tableSchema.name as string]) as { config: TablePluginConfig };
    expect((config as unknown as { showPricing: boolean }).showPricing).toBe(true);

    const totals = totalsConfig(result);
    expect(totals.itemDiscountTotal).toBe(5);
    expect(totals.subtotal).toBe(65);
  });

  it("the totals block reserves extra height when line items carry discounts", () => {
    const withoutDiscount = composeDocument(
      "quote",
      makeData({ line_items: [makeLineItem({ id: "a", status: "CONFIRMED", model: { name: "K10.2" }, discount: null })] }),
      "#0d4f4f",
    );
    const withDiscount = composeDocument(
      "quote",
      makeData({ line_items: [makeLineItem({ id: "a", status: "CONFIRMED", model: { name: "K10.2" }, discount: 5 })] }),
      "#0d4f4f",
    );
    const heightOf = (r: ComposeResult) => {
      const entry = r.template.schemas[0].find((s) => s.type === "gearflowFinancialSummary")!;
      return entry.height as number;
    };
    expect(heightOf(withDiscount)).toBeGreaterThan(heightOf(withoutDiscount));
  });
});

// ─── WS11 (#950) — mixed rental + SALE fixture, full pipeline ─────────────────
//
// CLAUDE.md's PDF five-consumer-audit rule: any DocumentLineItem shape change
// needs a full-pipeline test (structureLineItems -> calculateItemHeight ->
// filter -> plugin render), not just plugin-only harness assertions. This
// exercises composeDocument (which chains all of the above) across every doc
// type with a fixture mixing ordinary rental EQUIPMENT lines and SALE lines
// in a few different states (checked-out, still-quoted/CONFIRMED, and one
// inside a Project Group), asserting the spec's per-doc-type inclusion rules:
//   - quote/invoice: SALE included, "SALE" badge rendered
//   - delivery-docket/packing-list: SALE included REGARDLESS of status
//   - return-sheet: SALE excluded entirely, regardless of status
function makeMixedRentalSaleLineItems(): DocumentLineItem[] {
  return [
    // Ordinary rental gear, checked out — passes every doc type's filter.
    makeLineItem({
      id: "rental-1",
      description: "PA Speaker",
      quantity: 2,
      checkedOutQuantity: 2,
      unitPrice: 100,
      lineTotal: 200,
      status: "CHECKED_OUT",
      model: { name: "PA Speaker" },
    }),
    // A NEW_STOCK sale, still CONFIRMED (never checked out — a sale never
    // goes through the warehouse checkout workflow at all).
    makeLineItem({
      id: "sale-new-stock",
      description: "SM58 Mic",
      type: "SALE",
      quantity: 1,
      checkedOutQuantity: 0,
      unitPrice: 120,
      lineTotal: 120,
      pricingType: "FLAT",
      duration: 1,
      status: "CONFIRMED",
      model: { name: "SM58" },
    }),
    // A FROM_RENTAL_STOCK sale of a specific (now SOLD) asset, also never
    // checked out through the warehouse flow.
    makeLineItem({
      id: "sale-from-rental",
      description: "Sold XLR Cable",
      type: "SALE",
      quantity: 1,
      checkedOutQuantity: 0,
      unitPrice: 15,
      lineTotal: 15,
      pricingType: "FLAT",
      duration: 1,
      status: "CONFIRMED",
      model: { name: "XLR Cable" },
      asset: { assetTag: "CABLE-42" },
    }),
    // A SALE line riding inside a Project Group (spec: "no separate Sales
    // bucket — badge differentiates"), alongside an ordinary rental member.
    makeLineItem({
      id: "group-1",
      description: "Package Deal",
      isGroupRow: true,
      groupName: "Package Deal",
      quantity: 1,
      checkedOutQuantity: 1,
      status: "CHECKED_OUT",
      model: { name: "Package Deal" },
      childLineItems: [
        makeLineItem({ id: "group-member-rental", quantity: 1, checkedOutQuantity: 1, status: "CHECKED_OUT", model: { name: "Mixer" } }),
        makeLineItem({ id: "group-member-sale", type: "SALE", quantity: 1, checkedOutQuantity: 0, status: "CONFIRMED", model: { name: "Cable Bundle" } }),
      ],
    }),
  ];
}

describe("composeDocument — mixed rental + SALE fixture (WS11 #950)", () => {
  const STANDALONE_SALE_IDS = ["sale-new-stock", "sale-from-rental"];

  for (const docType of PROJECT_DOC_TYPES) {
    it(`${docType}: paginates the mixed fixture with no tail-drop`, () => {
      const lineItems = makeMixedRentalSaleLineItems();
      const data = makeData({ line_items: lineItems, total_items: lineItems.length });
      const result = composeDocument(docType, data, "#0d4f4f");

      const layout = DOCUMENT_LAYOUTS[docType];
      const topLevel = lineItems.filter((i) => !i.isKitChild && !i.isContainerLineItem);
      const totalParents = layout.filterByStatus
        ? topLevel.filter((i) => {
            if (i.type === "SALE") return docType !== "return-sheet";
            if (i.isGroupRow) {
              return (i.childLineItems ?? []).some((c) => (c.type === "SALE" ? docType !== "return-sheet" : layout.filterByStatus!.includes(c.status)));
            }
            return layout.filterByStatus!.includes(i.status);
          }).length
        : topLevel.length;

      assertFullCoverage(result, totalParents);
    });
  }

  it("quote: standalone SALE lines are included and rendered with a SALE badge", async () => {
    const result = await runTablePlugin(makeMixedRentalSaleLineItems(), {
      documentType: "quote",
      filterByStatus: null,
      showBadges: true,
    });
    const texts = result.drawText.map((t) => t.text);
    expect(texts.some((t) => t.includes("SM58"))).toBe(true);
    expect(texts).toContain("SALE");
  });

  it("packing-list: SALE lines are included even though they were never checked out (status CONFIRMED)", async () => {
    const result = await runTablePlugin(makeMixedRentalSaleLineItems(), {
      documentType: "packing-list",
      filterByStatus: null, // packing-list sets no filterByStatus (document-layouts.ts)
    });
    const texts = result.drawText.map((t) => t.text);
    expect(texts.some((t) => t.includes("SM58"))).toBe(true);
    expect(texts.some((t) => t.includes("XLR Cable"))).toBe(true);
  });

  it("delivery-docket: SALE lines are included despite failing the CHECKED_OUT status filter", async () => {
    const result = await runTablePlugin(makeMixedRentalSaleLineItems(), {
      documentType: "delivery-docket",
      filterByStatus: ["CHECKED_OUT"],
    });
    const texts = result.drawText.map((t) => t.text);
    expect(texts.some((t) => t.includes("SM58"))).toBe(true);
    expect(texts.some((t) => t.includes("XLR Cable"))).toBe(true);
    // The ordinary rental line (CHECKED_OUT) is included too, as always.
    expect(texts.some((t) => t.includes("PA Speaker"))).toBe(true);
  });

  it("return-sheet: SALE lines are excluded entirely, regardless of status", async () => {
    const result = await runTablePlugin(makeMixedRentalSaleLineItems(), {
      documentType: "return-sheet",
      filterByStatus: ["CHECKED_OUT", "RETURNED"],
    });
    const texts = result.drawText.map((t) => t.text);
    expect(texts.some((t) => t.includes("SM58"))).toBe(false);
    expect(texts.some((t) => t.includes("XLR Cable"))).toBe(false);
    expect(texts).not.toContain("SALE");
  });

  it("getFilteredParentItems: a SALE line inside a group takes no separate bucket — the group stays one parent row", () => {
    const lineItems = makeMixedRentalSaleLineItems();
    const data = makeData({ line_items: lineItems, total_items: lineItems.length });
    // Full pipeline via composeDocument for the quote doc type (no filterByStatus).
    const result = composeDocument("quote", data, "#0d4f4f");
    // Top-level parents: rental-1, sale-new-stock, sale-from-rental, group-1 = 4
    // (group members are children, not separate top-level parents).
    assertFullCoverage(result, 4);
  });

  it("STANDALONE_SALE_IDS fixture sanity: both standalone sale lines are ungrouped, non-kit-child", () => {
    const lineItems = makeMixedRentalSaleLineItems();
    for (const id of STANDALONE_SALE_IDS) {
      const li = lineItems.find((l) => l.id === id)!;
      expect(li.isKitChild).toBeFalsy();
      expect(li.groupName).toBeFalsy();
    }
  });
});

// ─── Accurate wrap-aware pagination for clientNotes/termsAndConditions ────────
//
// Repro of a real bug: a long terms & conditions block (many bulleted clauses,
// several of which word-wrap onto a second physical line) rendered on a quote
// where the raw-"\n"-count height estimate under-counted the real wrapped
// line total, so the reserved space was too small — the actual text ran past
// its box into the footer. Fixed by measuring the SAME wrapRichText() output
// used at render time, and by letting clientNotes/termsAndConditions split
// across pages (like the table already does) instead of always moving whole.

/** A realistic long T&Cs: numbered sections, several long clauses that word-wrap
 *  onto more physical lines than there are literal `\n`s in the source. */
function makeLongTermsAndConditions(sections = 10): string {
  const lines: string[] = [];
  for (let s = 1; s <= sections; s++) {
    lines.push(`${s}. SECTION ${s} HEADING`);
    lines.push(
      `- ${s}.1 This is a long clause that should word-wrap across more than one physical line once it is rendered at the document's real content width, the exact scenario the literal-newline-count heuristic could never see coming.`,
    );
    lines.push(`- ${s}.2 A second, shorter clause.`);
    lines.push(`- ${s}.3 A third clause with just enough text to matter.`);
  }
  return lines.join("\n");
}

function findAllSchemasOfType(result: ComposeResult, type: string) {
  return result.template.schemas.flatMap((pageSchemas, pageIdx) =>
    pageSchemas.filter((s) => s.type === type).map((s) => ({ schema: s, pageIdx })),
  );
}

describe("composeDocument — accurate rich-text pagination (fonts provided)", () => {
  it("estimates termsAndConditions height from real wrapped lines, not raw newline count, when fonts are supplied", async () => {
    const fonts = await makeFonts();
    const text = makeLongTermsAndConditions(3);
    const rawNewlineCount = text.split("\n").length;
    const realWrappedCount = wrapRichText(text, { maxWidth: mm2pt(CONTENT_WIDTH), fontSize: 8, fonts }).length;

    // The long clauses genuinely wrap onto extra physical lines — the fixture
    // is only a meaningful regression test if this holds.
    expect(realWrappedCount).toBeGreaterThan(rawNewlineCount);

    const withFonts = composeDocument("quote", makeData({ terms_and_conditions: text }), "#0d4f4f", fonts);
    const withoutFonts = composeDocument("quote", makeData({ terms_and_conditions: text }), "#0d4f4f");

    const heightOf = (r: ComposeResult) =>
      findAllSchemasOfType(r, "gearflowRichText")
        .filter(({ schema }) => (schema.name as string).startsWith("termsAndConditions_"))
        .reduce((sum, { schema }) => sum + (schema.height as number), 0);

    // The accurate (fonts) estimate reserves MORE space than the old
    // raw-newline heuristic for text that wraps — the under-reservation
    // that caused the footer overlap is gone.
    expect(heightOf(withFonts)).toBeGreaterThan(heightOf(withoutFonts));
  });

  it("splits a terms & conditions block too long for one page across multiple pages with no dropped lines", async () => {
    const fonts = await makeFonts();
    const text = makeLongTermsAndConditions(20); // long enough to exceed a single page
    const result = composeDocument("quote", makeData({ terms_and_conditions: text }), "#0d4f4f", fonts);

    const tcEntries = findAllSchemasOfType(result, "gearflowRichText").filter(({ schema }) =>
      (schema.name as string).startsWith("termsAndConditions_"),
    );
    const pagesUsed = new Set(tcEntries.map((e) => e.pageIdx));
    expect(pagesUsed.size).toBeGreaterThan(1); // actually split, not silently overflowed on one page

    // Reassemble every rendered line across every page's slice, in order,
    // and confirm it's IDENTICAL to wrapping the source text once — no
    // line dropped, none duplicated.
    const expectedLines = wrapRichText(text, { maxWidth: mm2pt(CONTENT_WIDTH), fontSize: 8, fonts });
    const renderedLineTexts = tcEntries.flatMap(({ schema }) => {
      const input = result.inputs[0][schema.name as string];
      const parsed = JSON.parse(input) as { lines: { spans: { text: string }[] }[] };
      return parsed.lines.map((l) => l.spans.map((s) => s.text).join(""));
    });
    const expectedLineTexts = expectedLines.map((l) => l.spans.map((s) => s.text).join(""));
    expect(renderedLineTexts).toEqual(expectedLineTexts);
  });

  it("without fonts, a very long T&Cs block still moves whole to a fresh page (unchanged fallback behavior)", () => {
    const text = makeLongTermsAndConditions(20);
    const result = composeDocument("quote", makeData({ terms_and_conditions: text }), "#0d4f4f");
    const tcEntries = findAllSchemasOfType(result, "gearflowRichText").filter(({ schema }) =>
      (schema.name as string).startsWith("termsAndConditions_"),
    );
    // Exactly one schema — never split when fonts weren't provided.
    expect(tcEntries).toHaveLength(1);
  });

  // I5 (#1084) — the same "no dropped/duplicated lines" invariant, but wrapped
  // against Letter's WIDER content area. A wider page wraps fewer physical
  // lines for the same source text — this only passes if the wrap width used
  // to reserve space, split pages, AND reconstruct the expected lines all
  // agree on Letter's contentWidth, not a hardcoded A4 one.
  it("Letter paper: wraps at its own (wider) content width, and still splits with no dropped lines", async () => {
    const fonts = await makeFonts();
    const text = makeLongTermsAndConditions(20);

    const a4Width = getPageGeometry("A4").contentWidth;
    const letterWidth = getPageGeometry("LETTER").contentWidth;
    expect(letterWidth).toBeGreaterThan(a4Width); // the precondition this test exists to exercise

    const a4Lines = wrapRichText(text, { maxWidth: mm2pt(a4Width), fontSize: 8, fonts });
    const letterLines = wrapRichText(text, { maxWidth: mm2pt(letterWidth), fontSize: 8, fonts });
    // A wider page can never wrap to MORE lines than a narrower one for the
    // same text — whether it wraps to fewer depends on exact word-boundary
    // placement for this specific fixture, so this is <=, not <.
    expect(letterLines.length).toBeLessThanOrEqual(a4Lines.length);

    const result = composeDocument(
      "quote",
      makeData({ terms_and_conditions: text }),
      "#0d4f4f",
      fonts,
      undefined,
      "LETTER",
    );
    const tcEntries = findAllSchemasOfType(result, "gearflowRichText").filter(({ schema }) =>
      (schema.name as string).startsWith("termsAndConditions_"),
    );
    expect(new Set(tcEntries.map((e) => e.pageIdx)).size).toBeGreaterThan(1);

    const renderedLineTexts = tcEntries.flatMap(({ schema }) => {
      const input = result.inputs[0][schema.name as string];
      const parsed = JSON.parse(input) as { lines: { spans: { text: string }[] }[] };
      return parsed.lines.map((l) => l.spans.map((s) => s.text).join(""));
    });
    const expectedLineTexts = letterLines.map((l) => l.spans.map((s) => s.text).join(""));
    expect(renderedLineTexts).toEqual(expectedLineTexts);
  });
});

describe("composeDocument — draft preview watermark (#987)", () => {
  const soloItems = () => [
    makeLineItem({ id: "only-item", status: "CHECKED_OUT", checkedOutQuantity: 1, model: { name: "Solo Item" } }),
  ];

  it("is absent by default — a STORED artifact must never carry it", () => {
    for (const docType of PROJECT_DOC_TYPES) {
      const result = composeDocument(docType, makeData({ line_items: soloItems() }), "#0d4f4f");
      expect(findAllSchemasOfType(result, "gearflowDraftWatermark")).toHaveLength(0);
    }
  });

  it("stamps 'DRAFT PREVIEW — NOT SENT' on the preview render", () => {
    const result = composeDocument("quote", makeData({ line_items: soloItems() }), "#0d4f4f", undefined, {
      draftPreview: true,
    });

    const marks = findAllSchemasOfType(result, "gearflowDraftWatermark");
    expect(marks).toHaveLength(1);
    const config = JSON.parse(result.inputs[0][marks[0].schema.name as string]);
    expect(config.title).toBe("DRAFT PREVIEW — NOT SENT");
    expect(config.subtitle.length).toBeGreaterThan(0);
  });

  it("reserves its own height — the block below it starts lower than it would without the banner", () => {
    const data = makeData({ line_items: soloItems() });
    const plain = composeDocument("quote", data, "#0d4f4f");
    const preview = composeDocument("quote", data, "#0d4f4f", undefined, { draftPreview: true });

    const mark = findAllSchemasOfType(preview, "gearflowDraftWatermark")[0].schema;
    expect(mark.height).toBeGreaterThan(0);

    const firstTableY = (r: ComposeResult) => findAllSchemasOfType(r, "gearflowTable")[0].schema.position.y;
    // Exactly the banner + its section gap — no more, no less: an unreserved
    // (or over-reserved) block is the v0.8.1.1 tail-drop class of bug.
    expect(firstTableY(preview) - firstTableY(plain)).toBeCloseTo((mark.height as number) + SECTION_GAP, 5);
  });

  it("repeats on EVERY page — a banner on page 1 of a 4-page quote is not a warning", () => {
    const lineItems = makeLongLineItemList(120);
    const result = composeDocument("quote", makeData({ line_items: lineItems, total_items: lineItems.length }), "#0d4f4f", undefined, {
      draftPreview: true,
    });

    expect(result.template.schemas.length).toBeGreaterThan(1);
    for (const pageSchemas of result.template.schemas) {
      expect(pageSchemas.some((s) => s.type === "gearflowDraftWatermark")).toBe(true);
    }
  });

  it("still renders every line item — the banner steals space without dropping the tail", () => {
    const lineItems = makeLongLineItemList(120);
    const data = makeData({ line_items: lineItems, total_items: lineItems.length });
    const result = composeDocument("quote", data, "#0d4f4f", undefined, { draftPreview: true });

    const expectedParents = lineItems.filter((i) => !i.isKitChild && !i.isContainerLineItem).length;
    assertFullCoverage(result, expectedParents);
  });
});

describe("composeDocument — termsAndConditions.forceNewPage", () => {
  it("T&Cs never shares a page with the table/totals/notes above it, even when there's room left", () => {
    // A short document — table + totals + a short T&Cs block would easily
    // all fit on one page without forceNewPage.
    const result = composeDocument(
      "quote",
      makeData({
        line_items: [makeLineItem({ id: "a", status: "CONFIRMED", model: { name: "USB Pro DI" }, unitPrice: 20, lineTotal: 20 })],
        terms_and_conditions: "Standard terms apply.",
      }),
      "#0d4f4f",
    );

    const tableSchema = result.template.schemas[0].find((s) => s.type === "gearflowTable");
    expect(tableSchema).toBeDefined(); // table is on page 0, as expected

    const tcPageIdx = result.template.schemas.findIndex((pageSchemas) =>
      pageSchemas.some((s) => String(s.name).startsWith("termsAndConditions")),
    );
    expect(tcPageIdx).toBeGreaterThan(0);
    // Nothing else shares that page with T&Cs (it's the whole page's content).
    const tcPageKinds = result.template.schemas[tcPageIdx].map((s) => s.type);
    expect(tcPageKinds.filter((t) => t !== "gearflowPageHeader" && t !== "gearflowPageFooter")).toEqual(["gearflowRichText"]);
  });

  it("doesn't waste a blank leading page when T&Cs is already first on a fresh page", () => {
    // A table so long it already forces its own continuation page; T&Cs
    // then naturally starts fresh right after — forceNewPage shouldn't add
    // an EXTRA blank page on top of that.
    const items = makeLongLineItemList(60);
    const result = composeDocument(
      "quote",
      makeData({ line_items: items, terms_and_conditions: "Standard terms apply." }),
      "#0d4f4f",
    );
    const tcPageIdx = result.template.schemas.findIndex((pageSchemas) =>
      pageSchemas.some((s) => String(s.name).startsWith("termsAndConditions")),
    );
    const tcPageKinds = result.template.schemas[tcPageIdx].map((s) => s.type);
    // The T&Cs page has no OTHER content block (table/totals) sharing it —
    // proof forceNewPage fired — without an extra blank page before it.
    expect(tcPageKinds).not.toContain("gearflowTable");
    expect(tcPageKinds).not.toContain("gearflowFinancialSummary");
  });
});

// ─── Sub-hire "via <Supplier>" line height (tail-drop regression) ────────────
//
// Real bug #1 (fixed): calculateItemHeight (the pagination estimate) had no
// case for the "via <Supplier>" line gearflow-table.ts always draws under a
// sub-hire item's description — every sub-hire row's real rendered height
// silently exceeded what was reserved. On a quote with many sub-hire lines
// (a normal shape — most of a production's gear is commonly hired in from
// suppliers) this compounds: document-composer.ts believes more items fit
// on page 1 than actually do, the table's own render-time overflow guard
// then quietly stops mid-page, and since no continuation page was ever
// scheduled for the table, everything after that point — potentially entire
// trailing categories — is silently dropped from the PDF while still
// counted in the (independently-computed) subtotal.
//
// Real bug #2 (fixed): the "via <Supplier>" line ignored the item's
// showSubhireOnDocs toggle entirely — a sub-hire item toggled OFF still
// showed "via <Supplier>" on client-facing quote/invoice PDFs, leaking a
// detail the toggle exists specifically to hide from the client. It's now
// gated by isSubhireIndicatorVisible() (gearflow-table.ts), same as the
// SUBHIRE badge: always visible on internal docs (packing-list,
// return-sheet, delivery-docket), gated by showSubhireOnDocs on client docs
// (quote, invoice).
describe("calculateItemHeight — sub-hire 'via Supplier' line (tail-drop + visibility regression)", () => {
  function quoteTableConfig() {
    const block = DOCUMENT_LAYOUTS.quote.blocks.find((b) => b.kind === "table");
    if (block?.kind !== "table") throw new Error("quote layout has no table block");
    return block.config;
  }

  it("reserves extra height for a sub-hire item with showSubhireOnDocs on, on a client doc", () => {
    const config = quoteTableConfig();
    const plain = makeLineItem({ id: "a", model: { name: "GrandMA 3 Console" } });
    const subHire = makeLineItem({
      id: "b",
      model: { name: "GrandMA 3 Console" },
      subHireId: "sh-1",
      supplierName: "Resolution X",
      showSubhireOnDocs: true,
    });
    expect(calculateItemHeight(subHire, config, "quote")).toBeGreaterThan(calculateItemHeight(plain, config, "quote"));
  });

  it("reserves NO extra height for a sub-hire item with showSubhireOnDocs off, on a client doc", () => {
    const config = quoteTableConfig();
    const plain = makeLineItem({ id: "a", model: { name: "GrandMA 3 Console" } });
    const subHireHidden = makeLineItem({
      id: "b",
      model: { name: "GrandMA 3 Console" },
      subHireId: "sh-1",
      supplierName: "Resolution X",
      showSubhireOnDocs: false,
    });
    expect(calculateItemHeight(subHireHidden, config, "quote")).toBe(calculateItemHeight(plain, config, "quote"));
  });

  it("reserves extra height for a sub-hire item on an internal doc regardless of showSubhireOnDocs", () => {
    const config = quoteTableConfig();
    const plain = makeLineItem({ id: "a", model: { name: "GrandMA 3 Console" } });
    const subHire = makeLineItem({
      id: "b",
      model: { name: "GrandMA 3 Console" },
      subHireId: "sh-1",
      supplierName: "Resolution X",
      showSubhireOnDocs: false,
    });
    expect(calculateItemHeight(subHire, config, "packing-list")).toBeGreaterThan(
      calculateItemHeight(plain, config, "packing-list"),
    );
  });

  it("full pipeline: a quote with many sub-hire lines across several categories paginates with no tail-drop", () => {
    // Mirrors the real reported shape: several categories, most rows are
    // sub-hire ("via <Supplier>", visible on this client doc via
    // showSubhireOnDocs), long enough to force the table across multiple pages.
    const suppliers = ["Resolution X", "Madzin Productions"];
    const categoryNames = ["Power Distribution", "Site", "Audio", "Lighting", "Staging"];
    const items: DocumentLineItem[] = [];
    let i = 0;
    for (const cat of categoryNames) {
      for (let n = 0; n < 6; n++) {
        items.push(
          makeLineItem({
            id: `li-${i}`,
            status: "CONFIRMED",
            categoryName: cat,
            groupName: cat,
            model: { name: `${cat} Item ${n}` },
            unitPrice: 100 + i,
            lineTotal: 100 + i,
            subHireId: n % 2 === 0 ? `sh-${i}` : null,
            supplierName: n % 2 === 0 ? suppliers[i % suppliers.length] : null,
            showSubhireOnDocs: n % 2 === 0,
          }),
        );
        i++;
      }
    }

    const data = makeData({ line_items: items, subtotal: items.reduce((s, li) => s + (li.lineTotal ?? 0), 0) });
    const result = composeDocument("quote", data, "#0d4f4f");

    assertFullCoverage(result, items.length);
  });
});

// ─── Group header does not repeat on continuation pages (2026-07-28) ────────
//
// Real bug: every page recomputed the full groups Map and drew a group's
// header whenever ANY of its items fell in that page's slice — including a
// page that merely continues a group started on the page before. On a doc
// with a category long enough to span several pages, its header printed at
// the top of every one of them. Fixed by only drawing a group's header on
// the page where it *starts*; the composer's height budget for continuation
// pages was updated in lockstep (it used to reserve extra space assuming the
// header would repeat).
describe("composeDocument + gearflowTable — group header prints once across a multi-page group", () => {
  it("a single long group spanning 3+ pages draws its header exactly once, and every item still renders", async () => {
    const items: DocumentLineItem[] = [];
    for (let i = 0; i < 100; i++) {
      items.push(
        makeLineItem({
          id: `li-${i}`,
          status: "CONFIRMED",
          categoryName: "Lighting",
          groupName: "Lighting",
          model: { name: `Lighting Item ${i}` },
          unitPrice: 100 + i,
          lineTotal: 100 + i,
        }),
      );
    }

    const data = makeData({ line_items: items, subtotal: items.reduce((s, li) => s + (li.lineTotal ?? 0), 0) });
    const result = composeDocument("quote", data, "#0d4f4f");

    expect(result.template.schemas.length).toBeGreaterThan(2); // actually spans several pages
    assertFullCoverage(result, items.length);

    const tableBlock = DOCUMENT_LAYOUTS.quote.blocks.find((b) => b.kind === "table");
    if (tableBlock?.kind !== "table") throw new Error("quote layout has no table block");
    const tableConfig: TablePluginConfig = {
      documentType: "quote",
      documentColor: "#0d4f4f",
      showGroupHeaders: tableBlock.config.showGroupHeaders,
      showKitChildren: tableBlock.config.showKitChildren,
      showCheckboxes: tableBlock.config.showCheckboxes,
      showConditionColumns: tableBlock.config.showConditionColumns,
      showPricing: tableBlock.config.showPricing,
      showBadges: tableBlock.config.showBadges,
      showNotes: tableBlock.config.showNotes,
      showPerUnitCheckboxes: tableBlock.config.showPerUnitCheckboxes,
      showAssetTags: tableBlock.config.showAssetTags,
      showCategories: tableBlock.config.showCategories,
      showRowNumbers: tableBlock.config.showRowNumbers,
      filterOptional: false,
      filterByStatus: null,
      hidePricingPeriodSuffix: tableBlock.config.hidePricingPeriodSuffix ?? false,
    };

    let headerDrawCount = 0;
    for (const pageSchemas of result.template.schemas) {
      const tableSchema = pageSchemas.find((s) => s.type === "gearflowTable");
      if (!tableSchema) continue;
      const value = JSON.parse(result.inputs[0][tableSchema.name as string]) as {
        startIndex?: number;
        endIndex?: number;
        startSubIndex?: number;
      };
      const calls = await runTablePlugin(items, tableConfig, value);
      headerDrawCount += calls.drawText.filter((c) => c.text === "Lighting").length;
    }

    expect(headerDrawCount).toBe(1);
  });
});

describe("composeDocument + gearflowTable — real allotted height covers every row drawn (#1149 regression)", () => {
  it("a trailing group of varied-content rows on a continuation page is fully drawn, not silently dropped", async () => {
    const items: DocumentLineItem[] = [];

    // A long "padding" group, long enough to push the trailing group below
    // onto a continuation page — the exact shape of the real incident
    // (a small "Services" group as the tail of a much longer quote).
    for (let i = 0; i < 40; i++) {
      items.push(
        makeLineItem({
          id: `pad-${i}`,
          status: "CONFIRMED",
          groupName: "Equipment",
          model: { name: `Equipment Item ${i}` },
          unitPrice: 100,
          lineTotal: 100,
        }),
      );
    }

    // The trailing group — mirrors the real "Services" group that silently
    // dropped its last row (AX Head Technician Day Rate): several rows,
    // each exercising a different height-affecting feature the composer's
    // estimate and gearflowTable's real draw both have to agree on.
    const servicesNames = [
      "Bump In",
      "Load Out",
      "Stage Manager Day Rate",
      "LX Head Technician Day Rate",
      "AX Head Technician Day Rate",
    ];
    servicesNames.forEach((name, i) => {
      items.push(
        makeLineItem({
          id: `svc-${i}`,
          status: "CONFIRMED",
          groupName: "Services",
          model: { name },
          unitPrice: 650,
          lineTotal: 650,
          ...(i === 1 ? { subHireId: "sh-1", supplierName: "Acme Crew Co", showSubhireOnDocs: true } : {}),
          ...(i === 2 ? { notes: "Confirmed via phone" } : {}),
        }),
      );
    });

    const data = makeData({ line_items: items, subtotal: items.reduce((s, li) => s + (li.lineTotal ?? 0), 0) });
    const result = composeDocument("quote", data, "#0d4f4f");

    expect(result.template.schemas.length).toBeGreaterThan(1); // actually paginates

    // Real quote table config (not a hand-duplicated copy of it) — pulling
    // from DOCUMENT_LAYOUTS is what keeps this test from silently drifting
    // out of sync with the layout it's supposed to be guarding.
    const tableBlock = DOCUMENT_LAYOUTS.quote.blocks.find((b) => b.kind === "table");
    if (tableBlock?.kind !== "table") throw new Error("quote layout has no table block");
    const tableConfig: TablePluginConfig = {
      documentType: "quote",
      documentColor: "#0d4f4f",
      showGroupHeaders: tableBlock.config.showGroupHeaders,
      showKitChildren: tableBlock.config.showKitChildren,
      showCheckboxes: tableBlock.config.showCheckboxes,
      showConditionColumns: tableBlock.config.showConditionColumns,
      showPricing: tableBlock.config.showPricing,
      showBadges: tableBlock.config.showBadges,
      showNotes: tableBlock.config.showNotes,
      showPerUnitCheckboxes: tableBlock.config.showPerUnitCheckboxes,
      showAssetTags: tableBlock.config.showAssetTags,
      showCategories: tableBlock.config.showCategories,
      showRowNumbers: tableBlock.config.showRowNumbers,
      filterOptional: false,
      filterByStatus: null,
      hidePricingPeriodSuffix: tableBlock.config.hidePricingPeriodSuffix ?? false,
    };

    let totalDrawn = 0;
    for (const pageSchemas of result.template.schemas) {
      const tableSchema = pageSchemas.find((s) => s.type === "gearflowTable");
      if (!tableSchema) continue;
      const value = JSON.parse(result.inputs[0][tableSchema.name as string]) as {
        startIndex?: number;
        endIndex?: number;
        startSubIndex?: number;
      };
      // The critical difference from the "group header prints once" test
      // above: hand the plugin the composer's REAL computed box for this
      // page (width + height), not runTablePlugin's generous fixed default.
      // A composer estimate that's even slightly smaller than what
      // gearflowTable actually needs will overflow THIS box exactly as it
      // would in production, instead of the test's slack masking it.
      const calls = await runTablePlugin(items, tableConfig, value, {
        width: tableSchema.width as number,
        height: tableSchema.height as number,
      });
      for (const name of servicesNames) {
        totalDrawn += calls.drawText.filter((c) => c.text === name).length;
      }
    }

    // Every service row's name must be drawn exactly once across all pages —
    // a real render-time overflow that silently drops a row (the #1149 bug)
    // shows up here as a count below servicesNames.length, with no error.
    expect(totalDrawn).toBe(servicesNames.length);
  });
});
