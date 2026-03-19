import { describe, it, expect } from "vitest";
import {
  estimateSectionHeight,
  computePageLayout,
  estimatePageBreaks,
} from "./section-renderer";
import type { DocumentData, DocumentLineItem, CrewEntry } from "./types";
import type { TemplateSection } from "./section-types";
import {
  TABLE_ROW_HEIGHT_MM,
  CREW_ROW_HEIGHT_MM,
  SECTION_HEIGHT_ESTIMATES,
} from "./section-types";
import { PAGE_HEIGHT, MARGIN, FOOTER_HEIGHT, SECTION_GAP } from "./template-constants";

// ─── Mock Factories ───────────────────────────────────────────────────────────

function makeLineItem(overrides: Partial<DocumentLineItem> = {}): DocumentLineItem {
  return {
    id: "item-1",
    description: "Test item",
    quantity: 1,
    checkedOutQuantity: 0,
    unitPrice: 100,
    pricingType: "FIXED",
    duration: 1,
    discount: null,
    lineTotal: 100,
    groupName: null,
    isOptional: false,
    isKitChild: false,
    notes: null,
    status: "CONFIRMED",
    model: { name: "Test Model" },
    asset: null,
    bulkAsset: null,
    ...overrides,
  };
}

function makeCrewEntry(overrides: Partial<CrewEntry> = {}): CrewEntry {
  return {
    name: "Test Crew",
    role: "Technician",
    phase: null,
    callTime: "09:00",
    endTime: "18:00",
    phone: null,
    email: null,
    notes: null,
    status: "CONFIRMED",
    ...overrides,
  };
}

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
    org_document_color: "#000000",
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
    subtotal: 1000,
    discount_percent: 0,
    discount_amount: 0,
    tax_label: "GST",
    tax_amount: 100,
    total: 1100,
    deposit_paid: 0,
    balance_due: 1100,
    client_notes: "",
    crew_notes: "",
    internal_notes: "",
    document_date: "2026-03-19",
    line_items: [],
    crew: [],
    total_items: 0,
    total_weight: 0,
    ...overrides,
  };
}

function makeSection(
  type: TemplateSection["type"],
  settings: TemplateSection["settings"],
  overrides: Partial<TemplateSection> = {},
): TemplateSection {
  return {
    id: `sec-${type}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    settings,
    visibility: {},
    order: 0,
    ...overrides,
  };
}

// ─── estimateSectionHeight ────────────────────────────────────────────────────

describe("estimateSectionHeight", () => {
  const data = makeData();

  describe("header", () => {
    it("returns base height (25) when logoMode is not 'logo'", () => {
      const section = makeSection("header", {
        logoMode: "icon",
        showOrgName: true,
        showOrgAddress: true,
        showOrgPhone: true,
        showOrgEmail: true,
        showOrgWebsite: true,
        documentTitle: "QUOTE",
      });
      expect(estimateSectionHeight(section, data)).toBe(25);
    });

    it("returns base + 22 when logoMode is 'logo'", () => {
      const section = makeSection("header", {
        logoMode: "logo",
        showOrgName: true,
        showOrgAddress: true,
        showOrgPhone: true,
        showOrgEmail: true,
        showOrgWebsite: true,
        documentTitle: "QUOTE",
      });
      expect(estimateSectionHeight(section, data)).toBe(47);
    });

    it("returns base height (25) when logoMode is 'none'", () => {
      const section = makeSection("header", {
        logoMode: "none",
        showOrgName: true,
        showOrgAddress: true,
        showOrgPhone: true,
        showOrgEmail: true,
        showOrgWebsite: true,
        documentTitle: "QUOTE",
      });
      expect(estimateSectionHeight(section, data)).toBe(25);
    });
  });

  describe("table", () => {
    it("returns correct height for 0 items (min = header + footer overhead)", () => {
      const section = makeSection("table", {
        showGroupHeaders: false,
        showKitChildren: false,
        showCheckboxes: false,
        showConditionColumns: false,
        showPricing: true,
        showBadges: true,
        showNotes: true,
        showPerUnitCheckboxes: false,
        showAssetTags: false,
        showCategories: false,
        showRowNumbers: false,
      });
      const d = makeData({ line_items: [] });
      // 0 items, 0 children => 8 + 0 * 5 + 4 = 12
      expect(estimateSectionHeight(section, d)).toBe(12);
    });

    it("returns correct height for N items", () => {
      const section = makeSection("table", {
        showGroupHeaders: false,
        showKitChildren: false,
        showCheckboxes: false,
        showConditionColumns: false,
        showPricing: true,
        showBadges: true,
        showNotes: true,
        showPerUnitCheckboxes: false,
        showAssetTags: false,
        showCategories: false,
        showRowNumbers: false,
      });
      const items = [makeLineItem({ id: "1" }), makeLineItem({ id: "2" }), makeLineItem({ id: "3" })];
      const d = makeData({ line_items: items });
      // 3 parent items, showKitChildren=false so 0 child rows => 8 + 3*5 + 4 = 27
      expect(estimateSectionHeight(section, d)).toBe(27);
    });

    it("includes kit children in height when showKitChildren is true", () => {
      const section = makeSection("table", {
        showGroupHeaders: false,
        showKitChildren: true,
        showCheckboxes: false,
        showConditionColumns: false,
        showPricing: true,
        showBadges: true,
        showNotes: true,
        showPerUnitCheckboxes: false,
        showAssetTags: false,
        showCategories: false,
        showRowNumbers: false,
      });
      const items = [
        makeLineItem({ id: "1", isKitChild: false }),
        makeLineItem({ id: "2", isKitChild: true }),
        makeLineItem({ id: "3", isKitChild: true }),
      ];
      const d = makeData({ line_items: items });
      // 1 parent, 2 children visible => 8 + 3*5 + 4 = 27
      expect(estimateSectionHeight(section, d)).toBe(27);
    });

    it("excludes kit children from height when showKitChildren is false", () => {
      const section = makeSection("table", {
        showGroupHeaders: false,
        showKitChildren: false,
        showCheckboxes: false,
        showConditionColumns: false,
        showPricing: true,
        showBadges: true,
        showNotes: true,
        showPerUnitCheckboxes: false,
        showAssetTags: false,
        showCategories: false,
        showRowNumbers: false,
      });
      const items = [
        makeLineItem({ id: "1", isKitChild: false }),
        makeLineItem({ id: "2", isKitChild: true }),
        makeLineItem({ id: "3", isKitChild: true }),
      ];
      const d = makeData({ line_items: items });
      // 1 parent, 0 visible children => 8 + 1*5 + 4 = 17
      expect(estimateSectionHeight(section, d)).toBe(17);
    });

    it("scales linearly with item count", () => {
      const settings = {
        showGroupHeaders: false,
        showKitChildren: false,
        showCheckboxes: false,
        showConditionColumns: false,
        showPricing: true,
        showBadges: true,
        showNotes: true,
        showPerUnitCheckboxes: false,
        showAssetTags: false,
        showCategories: false,
        showRowNumbers: false,
      };
      const overhead = 8 + 4; // header + footer constants

      for (const count of [1, 5, 10, 20]) {
        const items = Array.from({ length: count }, (_, i) => makeLineItem({ id: String(i) }));
        const d = makeData({ line_items: items });
        const section = makeSection("table", settings);
        expect(estimateSectionHeight(section, d)).toBe(overhead + count * TABLE_ROW_HEIGHT_MM);
      }
    });
  });

  describe("crew-table", () => {
    it("returns correct height for 0 crew", () => {
      const section = makeSection("crew-table", {
        showPhone: true,
        showEmail: true,
        showNotes: true,
      });
      const d = makeData({ crew: [] });
      // 8 + 0*5 + 4 = 12
      expect(estimateSectionHeight(section, d)).toBe(12);
    });

    it("returns correct height for N crew members", () => {
      const section = makeSection("crew-table", {
        showPhone: true,
        showEmail: true,
        showNotes: true,
      });
      const crew = [makeCrewEntry(), makeCrewEntry(), makeCrewEntry()];
      const d = makeData({ crew });
      // 8 + 3*5 + 4 = 27
      expect(estimateSectionHeight(section, d)).toBe(27);
    });

    it("scales linearly with crew count", () => {
      const settings = { showPhone: true, showEmail: true, showNotes: true };
      const overhead = 8 + 4;

      for (const count of [1, 5, 10]) {
        const crew = Array.from({ length: count }, () => makeCrewEntry());
        const d = makeData({ crew });
        const section = makeSection("crew-table", settings);
        expect(estimateSectionHeight(section, d)).toBe(overhead + count * CREW_ROW_HEIGHT_MM);
      }
    });
  });

  describe("custom-text", () => {
    it("returns minimum height (8) for empty content", () => {
      const section = makeSection(
        "custom-text",
        { fontSize: 9, fontWeight: "normal", alignment: "left" },
        { content: "" },
      );
      // 1 line (empty string split gives 1 element) => 1*4+4 = 8, max(8,8) = 8
      expect(estimateSectionHeight(section, data)).toBe(8);
    });

    it("returns correct height for single-line content", () => {
      const section = makeSection(
        "custom-text",
        { fontSize: 9, fontWeight: "normal", alignment: "left" },
        { content: "Single line" },
      );
      // 1 line => 1*4+4 = 8
      expect(estimateSectionHeight(section, data)).toBe(8);
    });

    it("returns correct height for multi-line content", () => {
      const section = makeSection(
        "custom-text",
        { fontSize: 9, fontWeight: "normal", alignment: "left" },
        { content: "Line one\nLine two\nLine three" },
      );
      // 3 lines => 3*4+4 = 16
      expect(estimateSectionHeight(section, data)).toBe(16);
    });

    it("returns correct height for five lines", () => {
      const section = makeSection(
        "custom-text",
        { fontSize: 9, fontWeight: "normal", alignment: "left" },
        { content: "a\nb\nc\nd\ne" },
      );
      // 5 lines => 5*4+4 = 24
      expect(estimateSectionHeight(section, data)).toBe(24);
    });

    it("returns minimum 8 when content is undefined", () => {
      const section = makeSection("custom-text", { fontSize: 9, fontWeight: "normal", alignment: "left" });
      // no content => "" => 1*4+4=8
      expect(estimateSectionHeight(section, data)).toBe(8);
    });
  });

  describe("spacer", () => {
    it("returns the configured height", () => {
      const section = makeSection("spacer", { height: 20 });
      expect(estimateSectionHeight(section, data)).toBe(20);
    });

    it("returns 10 when height is 0 (falsy fallback)", () => {
      const section = makeSection("spacer", { height: 0 });
      // s.height is 0, which is falsy => falls back to 10
      expect(estimateSectionHeight(section, data)).toBe(10);
    });

    it("returns custom heights correctly", () => {
      for (const h of [5, 15, 30, 50]) {
        const section = makeSection("spacer", { height: h });
        expect(estimateSectionHeight(section, data)).toBe(h);
      }
    });
  });

  describe("page-break", () => {
    it("returns 0", () => {
      const section = makeSection("page-break", {});
      expect(estimateSectionHeight(section, data)).toBe(0);
    });
  });

  describe("totals", () => {
    it("returns the static estimate from SECTION_HEIGHT_ESTIMATES", () => {
      const section = makeSection("totals", {
        showSubtotal: true,
        showDiscount: true,
        showTax: true,
        showTotal: true,
        showDeposit: false,
        showBalance: false,
      });
      expect(estimateSectionHeight(section, data)).toBe(SECTION_HEIGHT_ESTIMATES.totals);
    });
  });

  describe("signature", () => {
    it("returns the static estimate from SECTION_HEIGHT_ESTIMATES", () => {
      const section = makeSection("signature", { columns: 2, labels: ["By", "Received"] });
      expect(estimateSectionHeight(section, data)).toBe(SECTION_HEIGHT_ESTIMATES.signature);
    });
  });
});

// ─── computePageLayout ────────────────────────────────────────────────────────

describe("computePageLayout", () => {
  const CONTENT_HEIGHT = PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT;

  describe("single page", () => {
    it("places a few small sections on one page", () => {
      const sections: TemplateSection[] = [
        makeSection("header", { logoMode: "icon", showOrgName: true, showOrgAddress: true, showOrgPhone: true, showOrgEmail: true, showOrgWebsite: true, documentTitle: "Q" }, { order: 0 }),
        makeSection("custom-text", { fontSize: 9, fontWeight: "normal", alignment: "left" }, { order: 1, content: "Hello" }),
        makeSection("spacer", { height: 10 }, { order: 2 }),
      ];
      const data = makeData();
      const pages = computePageLayout(sections, data);
      expect(pages).toHaveLength(1);
      expect(pages[0].isContinuation).toBe(false);
      // All 3 sections should be in the single page
      expect(pages[0].entries).toHaveLength(3);
    });

    it("y positions increase with each section", () => {
      const sections: TemplateSection[] = [
        makeSection("spacer", { height: 10 }, { order: 0 }),
        makeSection("spacer", { height: 15 }, { order: 1 }),
        makeSection("spacer", { height: 20 }, { order: 2 }),
      ];
      const data = makeData();
      const pages = computePageLayout(sections, data);
      expect(pages).toHaveLength(1);
      const ys = pages[0].entries.map((e) => e.y);
      expect(ys[0]).toBeLessThan(ys[1]);
      expect(ys[1]).toBeLessThan(ys[2]);
    });

    it("first section starts at MARGIN y position", () => {
      const sections: TemplateSection[] = [
        makeSection("spacer", { height: 10 }, { order: 0 }),
      ];
      const data = makeData();
      const pages = computePageLayout(sections, data);
      expect(pages[0].entries[0].y).toBe(MARGIN);
    });
  });

  describe("page break section forces new page", () => {
    it("splits sections onto separate pages at page-break", () => {
      const sections: TemplateSection[] = [
        makeSection("spacer", { height: 10 }, { order: 0 }),
        makeSection("page-break", {}, { order: 1 }),
        makeSection("spacer", { height: 10 }, { order: 2 }),
      ];
      const data = makeData();
      const pages = computePageLayout(sections, data);
      expect(pages.length).toBeGreaterThanOrEqual(2);
      // Second page is a continuation
      expect(pages[1].isContinuation).toBe(true);
    });
  });

  describe("header repeated on continuation pages", () => {
    it("adds header section to continuation page entries", () => {
      // Build a header + a very tall table that forces a second page
      const headerSection = makeSection(
        "header",
        { logoMode: "none", showOrgName: true, showOrgAddress: true, showOrgPhone: true, showOrgEmail: true, showOrgWebsite: true, documentTitle: "Q" },
        { id: "hdr-fixed", order: 0 },
      );

      // Create enough line items to overflow one page
      // CONTENT_HEIGHT ~= 297 - 14 - 10 = 273. Table overhead = 12.
      // Each row = 5mm. Need > (273 - 12) / 5 ≈ 53 items to overflow.
      const items = Array.from({ length: 80 }, (_, i) => makeLineItem({ id: String(i) }));
      const tableSection = makeSection(
        "table",
        {
          showGroupHeaders: false,
          showKitChildren: false,
          showCheckboxes: false,
          showConditionColumns: false,
          showPricing: true,
          showBadges: true,
          showNotes: true,
          showPerUnitCheckboxes: false,
          showAssetTags: false,
          showCategories: false,
          showRowNumbers: false,
        },
        { id: "tbl-fixed", order: 1 },
      );

      const data = makeData({ line_items: items });
      const pages = computePageLayout([headerSection, tableSection], data);

      expect(pages.length).toBeGreaterThanOrEqual(2);

      // First page should not be a continuation
      expect(pages[0].isContinuation).toBe(false);

      // Second page should be a continuation and have the header in entries
      const p2 = pages[1];
      expect(p2.isContinuation).toBe(true);
      const headerEntry = p2.entries.find((e) => e.section.id === "hdr-fixed");
      expect(headerEntry).toBeDefined();
    });
  });

  describe("row grouping via layoutHint", () => {
    it("groups sections with same rowId into a single row", () => {
      // Two sections sharing the same rowId should be placed at the same Y
      const rowId = "row-abc";
      const sections: TemplateSection[] = [
        makeSection(
          "custom-text",
          { fontSize: 9, fontWeight: "normal", alignment: "left" },
          {
            id: "left",
            order: 0,
            content: "Left column",
            layoutHint: { rowId, columnIndex: 0, columnWidth: 50, columnCount: 2 },
          },
        ),
        makeSection(
          "custom-text",
          { fontSize: 9, fontWeight: "normal", alignment: "left" },
          {
            id: "right",
            order: 1,
            content: "Right column",
            layoutHint: { rowId, columnIndex: 1, columnWidth: 50, columnCount: 2 },
          },
        ),
      ];
      const data = makeData();
      const pages = computePageLayout(sections, data);
      expect(pages).toHaveLength(1);

      const leftEntry = pages[0].entries.find((e) => e.section.id === "left");
      const rightEntry = pages[0].entries.find((e) => e.section.id === "right");
      expect(leftEntry).toBeDefined();
      expect(rightEntry).toBeDefined();
      // Both should be placed at the same Y
      expect(leftEntry!.y).toBe(rightEntry!.y);
    });

    it("two sections with different rowIds are placed at different Y positions", () => {
      const sections: TemplateSection[] = [
        makeSection(
          "custom-text",
          { fontSize: 9, fontWeight: "normal", alignment: "left" },
          { id: "s1", order: 0, content: "Row 1" },
        ),
        makeSection(
          "custom-text",
          { fontSize: 9, fontWeight: "normal", alignment: "left" },
          { id: "s2", order: 1, content: "Row 2" },
        ),
      ];
      const data = makeData();
      const pages = computePageLayout(sections, data);
      const e1 = pages[0].entries.find((e) => e.section.id === "s1");
      const e2 = pages[0].entries.find((e) => e.section.id === "s2");
      expect(e1!.y).not.toBe(e2!.y);
    });

    it("grouped sections share the max column height as their row height", () => {
      // Left: 1-line text => 8mm; Right: 3-line text => 16mm.
      // Both should have height = 16 (max).
      const rowId = "row-heights";
      const sections: TemplateSection[] = [
        makeSection(
          "custom-text",
          { fontSize: 9, fontWeight: "normal", alignment: "left" },
          {
            id: "short",
            order: 0,
            content: "One line",
            layoutHint: { rowId, columnIndex: 0, columnWidth: 50, columnCount: 2 },
          },
        ),
        makeSection(
          "custom-text",
          { fontSize: 9, fontWeight: "normal", alignment: "left" },
          {
            id: "tall",
            order: 1,
            content: "Line 1\nLine 2\nLine 3",
            layoutHint: { rowId, columnIndex: 1, columnWidth: 50, columnCount: 2 },
          },
        ),
      ];
      const data = makeData();
      const pages = computePageLayout(sections, data);
      const shortEntry = pages[0].entries.find((e) => e.section.id === "short");
      const tallEntry = pages[0].entries.find((e) => e.section.id === "tall");
      // Both entries should have the same height (the max of 8 and 16)
      expect(shortEntry!.height).toBe(tallEntry!.height);
      expect(shortEntry!.height).toBe(16);
    });
  });

  describe("multi-page table splitting", () => {
    it("creates multiple pages when a header precedes a very large table", () => {
      // computePageLayout only splits a table when there are already entries on the
      // current page (entries.length > 0). A preceding header satisfies that condition.
      const headerSection = makeSection(
        "header",
        { logoMode: "none", showOrgName: true, showOrgAddress: true, showOrgPhone: true, showOrgEmail: true, showOrgWebsite: true, documentTitle: "Q" },
        { id: "hdr-split", order: 0 },
      );
      const items = Array.from({ length: 100 }, (_, i) => makeLineItem({ id: String(i) }));
      const tableSection = makeSection("table", {
        showGroupHeaders: false,
        showKitChildren: false,
        showCheckboxes: false,
        showConditionColumns: false,
        showPricing: true,
        showBadges: true,
        showNotes: true,
        showPerUnitCheckboxes: false,
        showAssetTags: false,
        showCategories: false,
        showRowNumbers: false,
      }, { order: 1 });

      const data = makeData({ line_items: items });
      const pages = computePageLayout([headerSection, tableSection], data);
      expect(pages.length).toBeGreaterThan(1);
    });

    it("continuation pages have tableStartIndex set on table entries", () => {
      // Same setup: header first so the table is guaranteed to split
      const headerSection = makeSection(
        "header",
        { logoMode: "none", showOrgName: true, showOrgAddress: true, showOrgPhone: true, showOrgEmail: true, showOrgWebsite: true, documentTitle: "Q" },
        { id: "hdr-idx", order: 0 },
      );
      const items = Array.from({ length: 100 }, (_, i) => makeLineItem({ id: String(i) }));
      const tableSection = makeSection("table", {
        showGroupHeaders: false,
        showKitChildren: false,
        showCheckboxes: false,
        showConditionColumns: false,
        showPricing: true,
        showBadges: true,
        showNotes: true,
        showPerUnitCheckboxes: false,
        showAssetTags: false,
        showCategories: false,
        showRowNumbers: false,
      }, { order: 1 });

      const data = makeData({ line_items: items });
      const pages = computePageLayout([headerSection, tableSection], data);

      // Pages after the first should have tableStartIndex > 0
      for (const page of pages.slice(1)) {
        const tableEntry = page.entries.find((e) => e.section.type === "table");
        if (tableEntry) {
          expect(tableEntry.tableStartIndex).toBeGreaterThan(0);
        }
      }
    });
  });
});

// ─── estimatePageBreaks ───────────────────────────────────────────────────────

describe("estimatePageBreaks", () => {
  const CONTENT_HEIGHT = PAGE_HEIGHT - MARGIN * 2 - FOOTER_HEIGHT;

  describe("no breaks", () => {
    it("returns empty array when all sections fit on one page", () => {
      const sections: TemplateSection[] = [
        makeSection("spacer", { height: 10 }, { order: 0 }),
        makeSection("spacer", { height: 10 }, { order: 1 }),
      ];
      const data = makeData();
      expect(estimatePageBreaks(sections, data)).toEqual([]);
    });

    it("returns empty array for a single small section", () => {
      const sections: TemplateSection[] = [
        makeSection("custom-text", { fontSize: 9, fontWeight: "normal", alignment: "left" }, { order: 0, content: "hi" }),
      ];
      const data = makeData();
      expect(estimatePageBreaks(sections, data)).toEqual([]);
    });

    it("returns empty array for empty sections list", () => {
      const data = makeData();
      expect(estimatePageBreaks([], data)).toEqual([]);
    });
  });

  describe("break detection", () => {
    it("detects a break when sections overflow the page content height", () => {
      // Use spacers totaling more than CONTENT_HEIGHT to force a break
      // CONTENT_HEIGHT = 297 - 14*2 - 10 = 259mm
      const sections: TemplateSection[] = Array.from({ length: 30 }, (_, i) =>
        makeSection("spacer", { height: 10 }, { order: i }),
      );
      // 30 spacers * 10mm = 300mm content, plus SECTION_GAPs, well over 259mm
      const data = makeData();
      const breaks = estimatePageBreaks(sections, data);
      expect(breaks.length).toBeGreaterThanOrEqual(1);
    });

    it("break position is within page content bounds", () => {
      const sections: TemplateSection[] = Array.from({ length: 30 }, (_, i) =>
        makeSection("spacer", { height: 10 }, { order: i }),
      );
      const data = makeData();
      const breaks = estimatePageBreaks(sections, data);
      for (const breakY of breaks) {
        expect(breakY).toBeLessThanOrEqual(CONTENT_HEIGHT);
        expect(breakY).toBeGreaterThan(0);
      }
    });

    it("returns break position for a large table preceded by a spacer", () => {
      // estimatePageBreaks only records a break when cumulativeY > 0 at the time
      // the overflow is detected. With a lone table as the first row, cumulativeY
      // starts at 0 so no break is recorded. A preceding spacer pushes cumulativeY
      // above 0, allowing the table overflow to trigger a break.
      const items = Array.from({ length: 80 }, (_, i) => makeLineItem({ id: String(i) }));
      const sections: TemplateSection[] = [
        makeSection("spacer", { height: 20 }, { order: 0 }),
        makeSection("table", {
          showGroupHeaders: false,
          showKitChildren: false,
          showCheckboxes: false,
          showConditionColumns: false,
          showPricing: true,
          showBadges: true,
          showNotes: true,
          showPerUnitCheckboxes: false,
          showAssetTags: false,
          showCategories: false,
          showRowNumbers: false,
        }, { order: 1 }),
      ];
      const data = makeData({ line_items: items });
      const breaks = estimatePageBreaks(sections, data);
      expect(breaks.length).toBeGreaterThanOrEqual(1);
    });

    it("explicit page-break section registers a break at its cumulative Y", () => {
      const sections: TemplateSection[] = [
        makeSection("spacer", { height: 20 }, { order: 0 }),
        makeSection("page-break", {}, { order: 1 }),
        makeSection("spacer", { height: 20 }, { order: 2 }),
      ];
      const data = makeData();
      const breaks = estimatePageBreaks(sections, data);
      // The page-break section should produce at least one break
      expect(breaks.length).toBeGreaterThanOrEqual(1);
      // The break position should equal the cumulative Y at the page-break point
      // First spacer: 20mm + 2mm gap = 22mm cumulativeY when page-break hit
      expect(breaks[0]).toBe(20 + SECTION_GAP);
    });
  });
});
