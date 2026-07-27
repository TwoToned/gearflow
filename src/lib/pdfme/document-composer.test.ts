/**
 * Full-pipeline integration tests for the composer (Phase 0 safety net,
 * docs/designs/pdf-system-redesign.md). These are the regression harness for
 * the new engine: every project doc type must paginate a long equipment list
 * across pages with NO silent tail-drop (the v0.8.1.x class of bug) and
 * repeat the header on every continuation page. Pagination invariants are
 * ported from the deleted section-renderer.test.ts as this engine's spec.
 */
import { describe, it, expect } from "vitest";
import { composeDocument, type ComposeResult } from "./document-composer";
import { DOCUMENT_LAYOUTS, type ProjectDocumentType } from "./document-layouts";
import { makeLineItem, runTablePlugin } from "./plugins/test-utils";
import type { DocumentData, DocumentLineItem, TablePluginConfig } from "./types";

function makeData(overrides: Partial<DocumentData> = {}): DocumentData {
  return {
    org_name: "Test Org",
    org_email: "org@test.com",
    org_phone: "0400 000 000",
    org_address: "1 Test St",
    org_website: "test.com",
    org_logo: null,
    org_icon: null,
    org_tax_rate: 10,
    org_tax_label: "GST",
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
    quote_terms_and_conditions: "",
    quote_valid_until: "2026-08-25",
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
    const result = composeDocument("quote", soloData({ quote_terms_and_conditions: "" }), "#0d4f4f");
    const hasTermsSchema = result.template.schemas[0].some((s) => String(s.name).startsWith("termsAndConditions"));
    expect(hasTermsSchema).toBe(false);
  });

  it("renders the T&Cs block when the org has set terms", () => {
    const result = composeDocument("quote", soloData({ quote_terms_and_conditions: "All sales final." }), "#0d4f4f");
    const termsSchema = result.template.schemas[0].find((s) => String(s.name).startsWith("termsAndConditions"))!;
    expect(termsSchema).toBeDefined();
    expect(result.inputs[0][termsSchema.name as string]).toBe("All sales final.");
  });

  it("renders the quote validity note using the real computed date, not static copy", () => {
    const result = composeDocument("quote", soloData({ quote_valid_until: "2026-09-15" }), "#0d4f4f");
    const validitySchema = result.template.schemas[0].find((s) => String(s.name).startsWith("quoteValidityNote"))!;
    expect(result.inputs[0][validitySchema.name as string]).toBe("This quote is valid until 2026-09-15.");
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

  function totalsConfig(result: ComposeResult): { discountAmount: number; discountPercent: number } {
    const totalsSchema = result.template.schemas[0].find((s) => s.type === "gearflowFinancialSummary")!;
    return JSON.parse(result.inputs[0][totalsSchema.name as string]);
  }

  it("quote table hides the '/day' (or other period) price suffix; other doc types are unaffected", () => {
    const { config: quoteConfig } = tableItemsAndConfig(composeDocument("quote", makeData({ line_items: [] }), "#0d4f4f"));
    expect(quoteConfig.hidePricingPeriodSuffix).toBe(true);

    const { config: invoiceConfig } = tableItemsAndConfig(composeDocument("invoice", makeData({ line_items: [] }), "#0d4f4f"));
    expect(invoiceConfig.hidePricingPeriodSuffix).toBe(false);
  });

  it("the price suffix is actually suppressed at render time on the quote", async () => {
    const item = makeLineItem({ id: "priced", status: "CONFIRMED", unitPrice: 100, pricingType: "PER_DAY", model: { name: "Priced Item" } });
    const { items, config } = tableItemsAndConfig(composeDocument("quote", makeData({ line_items: [item] }), "#0d4f4f"));
    const calls = await runTablePlugin(items, config);
    const text = calls.drawText.map((c) => c.text).join("\n");
    expect(text).not.toContain("/day");
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
