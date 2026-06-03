import { describe, it, expect } from "vitest";
import {
  estimateSectionHeight,
  computePageLayout,
  estimatePageBreaks,
  getUngroupedKey,
  getFilteredParentItems,
} from "./section-renderer";
import type { DocumentData, DocumentLineItem, CrewEntry } from "./types";
import type { TemplateSection } from "./section-types";
import {
  TABLE_ROW_HEIGHT_MM,
  CREW_ROW_HEIGHT_MM,
  SECTION_HEIGHT_ESTIMATES,
  getDefaultSections,
} from "./section-types";
import type { TableSectionSettings } from "./section-types";
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
    categoryName: null,
    groupTitle: null,
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
    department: null,
    breakMinutes: null,
    shiftLocation: null,
    shiftNotes: null,
    isProjectManager: false,
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
      // 0 items: headerRow(~6.7mm) + 0 content + safetyMargin(1) ≈ 7.7mm
      expect(estimateSectionHeight(section, d)).toBeCloseTo(7.7, 0);
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
      // 3 parent items: header(~6.7) + 3*parentRow(~6.0) + safetyMargin(1) ≈ 25.7mm
      expect(estimateSectionHeight(section, d)).toBeCloseTo(25.7, 0);
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
      // 1 parent item (children are filtered as isKitChild but no kitId on parent):
      // header(~6.7) + 1*parentRow(~6.0) + safetyMargin(1) ≈ 13.7mm
      expect(estimateSectionHeight(section, d)).toBeCloseTo(13.7, 0);
    });

    it("includes group-row childLineItems in height (kit-style group parents)", () => {
      // Regression: structureLineItems attaches non-kit group members as
      // childLineItems on the synthetic group row. The plugin renders those
      // children indented like kit children; the height calculator must
      // mirror that or the table will under-estimate its space and the
      // plugin will overflow and silently drop tail items.
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

      const groupParent = makeLineItem({
        id: "grp-1",
        isGroupRow: true,
        childLineItems: [
          makeLineItem({ id: "c1" }),
          makeLineItem({ id: "c2" }),
          makeLineItem({ id: "c3" }),
        ],
      });
      const plain = makeLineItem({ id: "plain" });

      const heightWithChildren = estimateSectionHeight(
        section,
        makeData({ line_items: [groupParent] }),
      );
      const heightPlain = estimateSectionHeight(
        section,
        makeData({ line_items: [plain] }),
      );

      // The group parent must reserve space for its 3 attached children —
      // strictly more than a plain row, by roughly 3 child rows worth.
      expect(heightWithChildren).toBeGreaterThan(heightPlain);
      expect(heightWithChildren - heightPlain).toBeGreaterThan(8);
    });

    it("group-row with EMPTY childLineItems uses plain-row height (no children to indent)", () => {
      // Collapse-mode shape: group row emitted with no childLineItems.
      // Should not reserve extra space.
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
      const groupRowNoChildren = makeLineItem({
        id: "grp-1",
        isGroupRow: true,
      });
      const plain = makeLineItem({ id: "plain" });
      const a = estimateSectionHeight(section, makeData({ line_items: [groupRowNoChildren] }));
      const b = estimateSectionHeight(section, makeData({ line_items: [plain] }));
      expect(a).toBeCloseTo(b, 1);
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
      // 1 parent, showKitChildren=false: header(~6.7) + 1*parentRow(~6.0) + safetyMargin(1) ≈ 13.7mm
      expect(estimateSectionHeight(section, d)).toBeCloseTo(13.7, 0);
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
      // Height should scale linearly with item count
      const heights: number[] = [];
      for (const count of [1, 5, 10, 20]) {
        const items = Array.from({ length: count }, (_, i) => makeLineItem({ id: String(i) }));
        const d = makeData({ line_items: items });
        const section = makeSection("table", settings);
        heights.push(estimateSectionHeight(section, d));
      }
      // Check linearity: difference between consecutive entries should be proportional to item count delta
      const perItem = (heights[1] - heights[0]) / 4; // 5-1 = 4 items
      expect((heights[2] - heights[0]) / 9).toBeCloseTo(perItem, 1); // 10-1 = 9 items
      expect((heights[3] - heights[0]) / 19).toBeCloseTo(perItem, 1); // 20-1 = 19 items
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

    it("produces reasonable page count for packing-list with per-unit checkboxes", () => {
      // Simulate a packing-list with groups and per-unit checkboxes
      // This is the scenario that was producing 64 pages instead of ~7
      const headerSection = makeSection(
        "header",
        { logoMode: "icon", showOrgName: true, showOrgAddress: true, showOrgPhone: true, showOrgEmail: true, showOrgWebsite: true, documentTitle: "PULL SLIP" },
        { order: 0 },
      );
      const clientSection = makeSection(
        "client-details",
        { showClientName: true, showClientContact: true, showClientEmail: true, showClientAddress: false, showClientTaxId: false },
        { order: 1 },
      );
      const projectSection = makeSection(
        "project-details",
        { showProjectName: true, showProjectNumber: true, showVenue: true, showRentalDates: true, showEventDates: false, showPaymentTerms: false, showSiteContact: false, showDocumentDate: true },
        { order: 2 },
      );

      // Create items similar to sample-document-data: 40 items across 10 groups, various quantities
      const groups = [
        { name: "Audio", items: [4, 6, 2, 1, 2, 2, 4, 2] },
        { name: "PA System", items: [8, 4, 4, 2, 2] },
        { name: "Lighting", items: [12, 8, 6, 4, 16, 1, 2, 4] },
        { name: "Video", items: [1, 2, 2, 2, 2] },
        { name: "Rigging", items: [8, 12] },
        { name: "Power", items: [2, 8] },
        { name: "Staging", items: [12, 48, 12] },
        { name: "Drape", items: [16, 10, 2] },
        { name: "Comms", items: [1, 6, 6] },
        { name: "Cases", items: [4] },
      ];

      let itemId = 0;
      const lineItems: DocumentLineItem[] = [];
      for (const group of groups) {
        for (const qty of group.items) {
          lineItems.push(makeLineItem({
            id: String(itemId++),
            quantity: qty,
            groupName: group.name,
          }));
        }
      }

      const tableSection = makeSection("table", {
        showGroupHeaders: true,
        showKitChildren: true,
        showCheckboxes: true,
        showConditionColumns: false,
        showPricing: false,
        showBadges: false,
        showNotes: false,
        showPerUnitCheckboxes: true,
        showAssetTags: true,
        showCategories: true,
        showRowNumbers: false,
      }, { order: 3 });

      const customTextSection = makeSection(
        "custom-text",
        { fontSize: 8, fontWeight: "normal", alignment: "left" },
        { order: 4, content: "Total items: 248" },
      );

      const data = makeData({ line_items: lineItems });
      const pages = computePageLayout(
        [headerSection, clientSection, projectSection, tableSection, customTextSection],
        data,
      );

      // With 40 items + 248 per-unit rows + 10 group headers:
      // Total content ≈ 1175mm. Should be about 6-8 pages, definitely not 64.
      expect(pages.length).toBeGreaterThanOrEqual(5);
      expect(pages.length).toBeLessThanOrEqual(10);

      // Verify startIndex increases monotonically across pages
      const startIndices = pages
        .map(p => p.entries.find(e => e.section.type === "table")?.tableStartIndex)
        .filter((idx): idx is number => idx !== undefined);
      for (let i = 1; i < startIndices.length; i++) {
        expect(startIndices[i]).toBeGreaterThan(startIndices[i - 1]);
      }
    });

    it("produces correct page count for simple table without per-unit checkboxes", () => {
      // 100 simple items, no groups, no per-unit checkboxes
      // Each item = ~6mm. Total ≈ 600mm content.
      // First page: ~185mm content. Continuation: ~213mm content.
      // Pages: 1 + ceil((600-185)/213) = 1 + ceil(415/213) = 1 + 2 = 3
      const headerSection = makeSection(
        "header",
        { logoMode: "none", showOrgName: true, showOrgAddress: true, showOrgPhone: true, showOrgEmail: true, showOrgWebsite: true, documentTitle: "Q" },
        { order: 0 },
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

      // 100 items * ~6mm = ~600mm. Should be 3-4 pages.
      expect(pages.length).toBeGreaterThanOrEqual(3);
      expect(pages.length).toBeLessThanOrEqual(5);
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

// ─── getUngroupedKey ──────────────────────────────────────────────────────────

describe("getUngroupedKey", () => {
  it("returns 'Ungrouped' for packing-list", () => {
    expect(getUngroupedKey("packing-list")).toBe("Ungrouped");
  });

  it("returns 'General' for delivery-docket", () => {
    expect(getUngroupedKey("delivery-docket")).toBe("General");
  });

  it("returns '_ungrouped' for quote", () => {
    expect(getUngroupedKey("quote")).toBe("_ungrouped");
  });

  it("returns '_ungrouped' for invoice", () => {
    expect(getUngroupedKey("invoice")).toBe("_ungrouped");
  });

  it("returns '_ungrouped' for return-sheet", () => {
    expect(getUngroupedKey("return-sheet")).toBe("_ungrouped");
  });

  it("returns '_ungrouped' for call-sheet", () => {
    expect(getUngroupedKey("call-sheet")).toBe("_ungrouped");
  });
});

// ─── getFilteredParentItems ───────────────────────────────────────────────────

describe("getFilteredParentItems", () => {
  it("filters out kit children", () => {
    const data = makeData({
      line_items: [
        makeLineItem({ id: "1", isKitChild: false }),
        makeLineItem({ id: "2", isKitChild: true }),
        makeLineItem({ id: "3", isKitChild: false }),
      ],
    });
    const result = getFilteredParentItems(data, "quote");
    expect(result).toHaveLength(2);
    expect(result.map(i => i.id)).toEqual(["1", "3"]);
  });

  it("does NOT filter by status for quote docType", () => {
    const data = makeData({
      line_items: [
        makeLineItem({ id: "1", status: "CONFIRMED" }),
        makeLineItem({ id: "2", status: "CHECKED_OUT" }),
        makeLineItem({ id: "3", status: "RETURNED" }),
      ],
    });
    const result = getFilteredParentItems(data, "quote");
    expect(result).toHaveLength(3);
  });

  it("filters by CHECKED_OUT status for delivery-docket", () => {
    const data = makeData({
      line_items: [
        makeLineItem({ id: "1", status: "CONFIRMED" }),
        makeLineItem({ id: "2", status: "CHECKED_OUT" }),
        makeLineItem({ id: "3", status: "RETURNED" }),
      ],
    });
    const result = getFilteredParentItems(data, "delivery-docket");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("filters by CHECKED_OUT and RETURNED for return-sheet", () => {
    const data = makeData({
      line_items: [
        makeLineItem({ id: "1", status: "CONFIRMED" }),
        makeLineItem({ id: "2", status: "CHECKED_OUT" }),
        makeLineItem({ id: "3", status: "RETURNED" }),
      ],
    });
    const result = getFilteredParentItems(data, "return-sheet");
    expect(result).toHaveLength(2);
    expect(result.map(i => i.id)).toEqual(["2", "3"]);
  });

  it("uses checkedOutQuantity > 0 for bulk items in delivery-docket", () => {
    const data = makeData({
      line_items: [
        makeLineItem({ id: "1", status: "CONFIRMED", quantity: 5, checkedOutQuantity: 3, bulkAssetId: "bulk-1" }),
        makeLineItem({ id: "2", status: "CONFIRMED", quantity: 5, checkedOutQuantity: 0, bulkAssetId: "bulk-2" }),
        makeLineItem({ id: "3", status: "CHECKED_OUT" }),
      ],
    });
    const result = getFilteredParentItems(data, "delivery-docket");
    // bulk-1 has checkedOutQuantity > 0, bulk-2 does not, item-3 has CHECKED_OUT status
    expect(result).toHaveLength(2);
    expect(result.map(i => i.id)).toEqual(["1", "3"]);
  });

  it("delivery-docket with all CONFIRMED items returns empty", () => {
    const data = makeData({
      line_items: [
        makeLineItem({ id: "1", status: "CONFIRMED" }),
        makeLineItem({ id: "2", status: "CONFIRMED" }),
      ],
    });
    const result = getFilteredParentItems(data, "delivery-docket");
    expect(result).toHaveLength(0);
  });
});

// ─── docType integration ──────────────────────────────────────────────────────

describe("docType integration", () => {
  it("delivery-docket produces fewer pages than quote for same data with mixed statuses", () => {
    const headerSection = makeSection(
      "header",
      { logoMode: "none", showOrgName: true, showOrgAddress: true, showOrgPhone: true, showOrgEmail: true, showOrgWebsite: true, documentTitle: "Q" },
      { order: 0 },
    );

    // 50 items, only 10 are CHECKED_OUT
    const items: DocumentLineItem[] = [];
    for (let i = 0; i < 50; i++) {
      items.push(makeLineItem({
        id: String(i),
        status: i < 10 ? "CHECKED_OUT" : "CONFIRMED",
      }));
    }

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

    const quotePages = computePageLayout([headerSection, tableSection], data, "quote");
    const docketPages = computePageLayout([headerSection, tableSection], data, "delivery-docket");

    // Quote shows all 50 items, delivery-docket shows only 10
    expect(quotePages.length).toBeGreaterThan(docketPages.length);
    // Delivery-docket with only 10 items should fit on 1 page
    expect(docketPages.length).toBe(1);
  });

  it("estimateSectionHeight for table is smaller with delivery-docket filtering", () => {
    const items: DocumentLineItem[] = [];
    for (let i = 0; i < 20; i++) {
      items.push(makeLineItem({
        id: String(i),
        status: i < 5 ? "CHECKED_OUT" : "CONFIRMED",
      }));
    }
    const data = makeData({ line_items: items });
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
    });

    const quoteHeight = estimateSectionHeight(tableSection, data, "quote");
    const docketHeight = estimateSectionHeight(tableSection, data, "delivery-docket");

    // Quote: 20 items, docket: 5 items
    expect(quoteHeight).toBeGreaterThan(docketHeight);
  });

  describe("call-sheet-info", () => {
    it("returns the static height estimate", () => {
      const section = makeSection("call-sheet-info", {
        showPmContact: true,
        showClientContact: true,
        showVenueDetails: true,
        showScheduleTimes: true,
        showEquipmentSummary: true,
      });
      expect(estimateSectionHeight(section, makeData())).toBe(
        SECTION_HEIGHT_ESTIMATES["call-sheet-info"]
      );
    });
  });

  describe("day-header", () => {
    it("returns the static height estimate", () => {
      const section = makeSection("day-header", {
        showPhases: true,
        showCrewCount: true,
      });
      expect(estimateSectionHeight(section, makeData())).toBe(
        SECTION_HEIGHT_ESTIMATES["day-header"]
      );
    });
  });

  describe("crew-table with dayCrew content override", () => {
    it("uses dayCrew length from content when present", () => {
      const dayCrew = [makeCrewEntry(), makeCrewEntry(), makeCrewEntry()];
      const section = makeSection(
        "crew-table",
        { showPhone: true, showEmail: false, showNotes: true },
        { content: JSON.stringify({ dayCrew }) },
      );
      const height = estimateSectionHeight(section, makeData());
      // Formula: 8 + crewCount * CREW_ROW_HEIGHT_MM + 4
      expect(height).toBe(8 + 3 * CREW_ROW_HEIGHT_MM + 4);
    });

    it("falls back to data.crew when content is invalid JSON", () => {
      const data = makeData({ crew: [makeCrewEntry(), makeCrewEntry()] });
      const section = makeSection(
        "crew-table",
        { showPhone: true, showEmail: false, showNotes: true },
        { content: "invalid-json" },
      );
      const height = estimateSectionHeight(section, data);
      // Formula: 8 + crewCount * CREW_ROW_HEIGHT_MM + 4
      expect(height).toBe(8 + 2 * CREW_ROW_HEIGHT_MM + 4);
    });
  });
});

describe("getDefaultSections per-unit defaults", () => {
  // Helper: pull the table section's settings out of a default section list.
  function tableSettings(docType: Parameters<typeof getDefaultSections>[0]): TableSectionSettings {
    const sections = getDefaultSections(docType);
    const table = sections.find((s) => s.type === "table");
    expect(table, `${docType} should have a table section`).toBeDefined();
    return table!.settings as TableSectionSettings;
  }

  // Regression: the delivery-docket section default was the one place
  // showPerUnitCheckboxes was missed, so multi-quantity lines collapsed to
  // "tag, tag +N" instead of listing every assigned asset tag on its own row.
  // The section render path (generate-pdf loadTemplate) reads `sections`
  // first, so this default — not the legacy settings blob — is what renders.
  it("delivery-docket lists one row per unit (showPerUnitCheckboxes: true)", () => {
    expect(tableSettings("delivery-docket").showPerUnitCheckboxes).toBe(true);
  });

  it("packing-list keeps per-unit rows", () => {
    expect(tableSettings("packing-list").showPerUnitCheckboxes).toBe(true);
  });

  it("return-sheet keeps per-unit rows", () => {
    expect(tableSettings("return-sheet").showPerUnitCheckboxes).toBe(true);
  });

  // Quote/invoice are commercial documents — they price the line, not the
  // physical units, so they should NOT expand to one row per asset tag.
  it("quote does not expand to per-unit rows", () => {
    expect(tableSettings("quote").showPerUnitCheckboxes).toBe(false);
  });

  it("invoice does not expand to per-unit rows", () => {
    expect(tableSettings("invoice").showPerUnitCheckboxes).toBe(false);
  });
});
