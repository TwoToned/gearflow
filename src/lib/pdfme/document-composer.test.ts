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
import { makeLineItem } from "./plugins/test-utils";
import type { DocumentData, DocumentLineItem } from "./types";

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
