import { describe, it, expect } from "vitest";
import type { TemplateBlock, TemplateSection } from "./section-types";
import {
  flattenBlocks,
  sectionsToBlocks,
  blocksToSections,
  isContentType,
  canFitInColumn,
  validateBlockTree,
  wrapInRow,
  createContentBlock,
} from "./block-utils";

// ─── flattenBlocks ───────────────────────────────────────────────────────────

describe("flattenBlocks", () => {
  it("flattens a single-column row", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [100],
        children: [
          {
            id: "col_1",
            type: "column",
            children: [
              { id: "sec_1", type: "header", settings: {} },
            ],
          },
        ],
      },
    ];

    const result = flattenBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("sec_1");
    expect(result[0].type).toBe("header");
    expect(result[0].order).toBe(0);
    expect(result[0].layoutHint).toEqual({
      rowId: "row_1",
      columnIndex: 0,
      columnWidth: 100,
      columnCount: 1,
      styling: undefined,
    });
  });

  it("flattens a two-column row", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [60, 40],
        children: [
          {
            id: "col_1",
            type: "column",
            children: [
              { id: "sec_1", type: "client-details", settings: {} },
            ],
          },
          {
            id: "col_2",
            type: "column",
            children: [
              { id: "sec_2", type: "project-details", settings: {} },
            ],
          },
        ],
      },
    ];

    const result = flattenBlocks(blocks);
    expect(result).toHaveLength(2);
    expect(result[0].layoutHint?.columnWidth).toBe(60);
    expect(result[0].layoutHint?.columnIndex).toBe(0);
    expect(result[0].layoutHint?.columnCount).toBe(2);
    expect(result[1].layoutHint?.columnWidth).toBe(40);
    expect(result[1].layoutHint?.columnIndex).toBe(1);
  });

  it("preserves section content and visibility", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [100],
        children: [
          {
            id: "col_1",
            type: "column",
            children: [
              {
                id: "sec_1",
                type: "custom-text",
                settings: { fontSize: 10, fontWeight: "normal", alignment: "left" },
                visibility: { docTypes: ["quote"] },
                content: "Hello {client_name}",
              },
            ],
          },
        ],
      },
    ];

    const result = flattenBlocks(blocks);
    expect(result[0].content).toBe("Hello {client_name}");
    expect(result[0].visibility).toEqual({ docTypes: ["quote"] });
    expect(result[0].settings).toEqual({ fontSize: 10, fontWeight: "normal", alignment: "left" });
  });

  it("preserves block styling in layoutHint", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [100],
        children: [
          {
            id: "col_1",
            type: "column",
            children: [
              {
                id: "sec_1",
                type: "notes",
                settings: {},
                styling: { backgroundColor: "#f0f0f0", padding: 4 },
              },
            ],
          },
        ],
      },
    ];

    const result = flattenBlocks(blocks);
    expect(result[0].layoutHint?.styling).toEqual({
      backgroundColor: "#f0f0f0",
      padding: 4,
    });
  });

  it("handles top-level content blocks (no row wrapper)", () => {
    const blocks: TemplateBlock[] = [
      { id: "sec_1", type: "header", settings: {} },
    ];

    const result = flattenBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].layoutHint?.columnWidth).toBe(100);
    expect(result[0].layoutHint?.columnCount).toBe(1);
  });

  it("returns empty array for empty input", () => {
    expect(flattenBlocks([])).toEqual([]);
  });

  it("sets incrementing order values", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [100],
        children: [
          {
            id: "col_1",
            type: "column",
            children: [
              { id: "s1", type: "header", settings: {} },
              { id: "s2", type: "table", settings: {} },
            ],
          },
        ],
      },
      {
        id: "row_2",
        type: "row",
        columnWidths: [100],
        children: [
          {
            id: "col_2",
            type: "column",
            children: [
              { id: "s3", type: "totals", settings: {} },
            ],
          },
        ],
      },
    ];

    const result = flattenBlocks(blocks);
    expect(result.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it("defaults to even column widths when columnWidths missing", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        children: [
          { id: "col_1", type: "column", children: [{ id: "s1", type: "notes", settings: {} }] },
          { id: "col_2", type: "column", children: [{ id: "s2", type: "notes", settings: {} }] },
        ],
      },
    ];

    const result = flattenBlocks(blocks);
    expect(result[0].layoutHint?.columnWidth).toBe(50);
    expect(result[1].layoutHint?.columnWidth).toBe(50);
  });

  it("skips column blocks at top level", () => {
    const blocks: TemplateBlock[] = [
      { id: "col_1", type: "column", children: [{ id: "s1", type: "header", settings: {} }] },
    ];

    const result = flattenBlocks(blocks);
    expect(result).toHaveLength(0);
  });
});

// ─── sectionsToBlocks ────────────────────────────────────────────────────────

describe("sectionsToBlocks", () => {
  it("wraps flat sections into single-column rows", () => {
    const sections: TemplateSection[] = [
      { id: "s1", type: "header", settings: {}, visibility: {}, order: 0 },
      { id: "s2", type: "table", settings: {}, visibility: {}, order: 1 },
    ];

    const result = sectionsToBlocks(sections);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("row");
    expect(result[0].columnWidths).toEqual([100]);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].type).toBe("column");
    expect(result[0].children![0].children).toHaveLength(1);
    expect(result[0].children![0].children![0].id).toBe("s1");
  });

  it("groups sections with the same rowId into one row", () => {
    const sections: TemplateSection[] = [
      {
        id: "s1", type: "client-details", settings: {}, visibility: {}, order: 0,
        layoutHint: { rowId: "row_1", columnIndex: 0, columnWidth: 50, columnCount: 2 },
      },
      {
        id: "s2", type: "project-details", settings: {}, visibility: {}, order: 1,
        layoutHint: { rowId: "row_1", columnIndex: 1, columnWidth: 50, columnCount: 2 },
      },
    ];

    const result = sectionsToBlocks(sections);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("row");
    expect(result[0].columnWidths).toEqual([50, 50]);
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children![0].children![0].id).toBe("s1");
    expect(result[0].children![1].children![0].id).toBe("s2");
  });

  it("preserves styling from layoutHint", () => {
    const sections: TemplateSection[] = [
      {
        id: "s1", type: "notes", settings: {}, visibility: {}, order: 0,
        layoutHint: {
          rowId: "row_1",
          columnIndex: 0,
          columnWidth: 100,
          columnCount: 1,
          styling: { backgroundColor: "#ff0000" },
        },
      },
    ];

    const result = sectionsToBlocks(sections);
    const contentBlock = result[0].children![0].children![0];
    expect(contentBlock.styling).toEqual({ backgroundColor: "#ff0000" });
  });

  it("handles empty array", () => {
    expect(sectionsToBlocks([])).toEqual([]);
  });

  it("handles mixed: some with layoutHint, some without", () => {
    const sections: TemplateSection[] = [
      { id: "s1", type: "header", settings: {}, visibility: {}, order: 0 },
      {
        id: "s2", type: "client-details", settings: {}, visibility: {}, order: 1,
        layoutHint: { rowId: "row_1", columnIndex: 0, columnWidth: 60, columnCount: 2 },
      },
      {
        id: "s3", type: "project-details", settings: {}, visibility: {}, order: 2,
        layoutHint: { rowId: "row_1", columnIndex: 1, columnWidth: 40, columnCount: 2 },
      },
      { id: "s4", type: "table", settings: {}, visibility: {}, order: 3 },
    ];

    const result = sectionsToBlocks(sections);
    expect(result).toHaveLength(3); // header row, combined row, table row
    expect(result[1].columnWidths).toEqual([60, 40]);
  });
});

// ─── Round-trip ──────────────────────────────────────────────────────────────

describe("round-trip conversion", () => {
  it("blocks → sections → blocks preserves structure", () => {
    const original: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [60, 40],
        children: [
          {
            id: "col_1",
            type: "column",
            children: [
              { id: "s1", type: "client-details", settings: { showClientName: true, showClientContact: true, showClientEmail: true, showClientAddress: true, showClientTaxId: false }, visibility: { docTypes: ["quote"] } },
            ],
          },
          {
            id: "col_2",
            type: "column",
            children: [
              { id: "s2", type: "project-details", settings: {} },
            ],
          },
        ],
      },
      {
        id: "row_2",
        type: "row",
        columnWidths: [100],
        children: [
          {
            id: "col_3",
            type: "column",
            children: [
              { id: "s3", type: "table", settings: {} },
            ],
          },
        ],
      },
    ];

    const sections = flattenBlocks(original);
    const roundTripped = sectionsToBlocks(sections);

    // Should have same number of rows
    expect(roundTripped).toHaveLength(2);

    // First row: 2 columns, 60/40 split
    expect(roundTripped[0].columnWidths).toEqual([60, 40]);
    expect(roundTripped[0].children).toHaveLength(2);
    expect(roundTripped[0].children![0].children![0].id).toBe("s1");
    expect(roundTripped[0].children![0].children![0].settings).toEqual({ showClientName: true, showClientContact: true, showClientEmail: true, showClientAddress: true, showClientTaxId: false });
    expect(roundTripped[0].children![1].children![0].id).toBe("s2");

    // Second row: 1 column, 100%
    expect(roundTripped[1].columnWidths).toEqual([100]);
    expect(roundTripped[1].children![0].children![0].id).toBe("s3");
  });

  it("flat sections → blocks → sections preserves data", () => {
    const original: TemplateSection[] = [
      { id: "s1", type: "header", settings: { logoMode: "icon", showOrgName: true, showOrgAddress: true, showOrgPhone: true, showOrgEmail: true, showOrgWebsite: true, documentTitle: "" }, visibility: {}, order: 0 },
      { id: "s2", type: "custom-text", settings: {}, visibility: {}, content: "Hello", order: 1 },
    ];

    const blocks = sectionsToBlocks(original);
    const sections = flattenBlocks(blocks);

    expect(sections).toHaveLength(2);
    expect(sections[0].id).toBe("s1");
    expect(sections[0].settings).toEqual({ logoMode: "icon", showOrgName: true, showOrgAddress: true, showOrgPhone: true, showOrgEmail: true, showOrgWebsite: true, documentTitle: "" });
    expect(sections[1].id).toBe("s2");
    expect(sections[1].content).toBe("Hello");
  });
});

// ─── blocksToSections alias ──────────────────────────────────────────────────

describe("blocksToSections", () => {
  it("is an alias for flattenBlocks", () => {
    expect(blocksToSections).toBe(flattenBlocks);
  });
});

// ─── isContentType ───────────────────────────────────────────────────────────

describe("isContentType", () => {
  it("returns true for section types", () => {
    expect(isContentType("header")).toBe(true);
    expect(isContentType("table")).toBe(true);
    expect(isContentType("custom-text")).toBe(true);
    expect(isContentType("page-break")).toBe(true);
  });

  it("returns false for structural types", () => {
    expect(isContentType("row")).toBe(false);
    expect(isContentType("column")).toBe(false);
  });

  it("returns false for unknown types", () => {
    expect(isContentType("banana")).toBe(false);
  });
});

// ─── canFitInColumn ──────────────────────────────────────────────────────────

describe("canFitInColumn", () => {
  it("table requires 100%", () => {
    expect(canFitInColumn("table", 100)).toBe(true);
    expect(canFitInColumn("table", 50)).toBe(false);
  });

  it("client-details fits in 33%+", () => {
    expect(canFitInColumn("client-details", 33)).toBe(true);
    expect(canFitInColumn("client-details", 25)).toBe(false);
  });

  it("custom-text fits in 25%+", () => {
    expect(canFitInColumn("custom-text", 25)).toBe(true);
    expect(canFitInColumn("custom-text", 20)).toBe(false);
  });

  it("signature fits in 33%+", () => {
    expect(canFitInColumn("signature", 50)).toBe(true);
    expect(canFitInColumn("signature", 30)).toBe(false);
  });
});

// ─── validateBlockTree ───────────────────────────────────────────────────────

describe("validateBlockTree", () => {
  it("returns no errors for valid tree", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [50, 50],
        children: [
          {
            id: "col_1",
            type: "column",
            children: [{ id: "s1", type: "client-details", settings: {} }],
          },
          {
            id: "col_2",
            type: "column",
            children: [{ id: "s2", type: "project-details", settings: {} }],
          },
        ],
      },
    ];
    expect(validateBlockTree(blocks)).toEqual([]);
  });

  it("catches too many columns", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [20, 20, 20, 20, 20],
        children: Array.from({ length: 5 }, (_, i) => ({
          id: `col_${i}`,
          type: "column" as const,
          children: [],
        })),
      },
    ];
    const errors = validateBlockTree(blocks);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("5 columns");
  });

  it("catches column widths not summing to 100", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [30, 30],
        children: [
          { id: "col_1", type: "column", children: [] },
          { id: "col_2", type: "column", children: [] },
        ],
      },
    ];
    const errors = validateBlockTree(blocks);
    expect(errors.some((e) => e.includes("sum to 60%"))).toBe(true);
  });

  it("catches width count mismatch", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [50, 50, 50],
        children: [
          { id: "col_1", type: "column", children: [] },
          { id: "col_2", type: "column", children: [] },
        ],
      },
    ];
    const errors = validateBlockTree(blocks);
    expect(errors.some((e) => e.includes("3 width values but 2 columns"))).toBe(true);
  });

  it("catches non-column children of row", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [100],
        children: [
          { id: "s1", type: "header", settings: {} },
        ],
      },
    ];
    const errors = validateBlockTree(blocks);
    expect(errors.some((e) => e.includes('must be type "column"'))).toBe(true);
  });

  it("catches structural blocks inside columns", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [100],
        children: [
          {
            id: "col_1",
            type: "column",
            children: [
              {
                id: "nested_row",
                type: "row",
                children: [],
              },
            ],
          },
        ],
      },
    ];
    const errors = validateBlockTree(blocks);
    expect(errors.some((e) => e.includes("structural block"))).toBe(true);
  });

  it("allows valid column widths summing to 100", () => {
    const blocks: TemplateBlock[] = [
      {
        id: "row_1",
        type: "row",
        columnWidths: [33, 34, 33],
        children: [
          { id: "col_1", type: "column", children: [] },
          { id: "col_2", type: "column", children: [] },
          { id: "col_3", type: "column", children: [] },
        ],
      },
    ];
    expect(validateBlockTree(blocks)).toEqual([]);
  });
});

// ─── wrapInRow ───────────────────────────────────────────────────────────────

describe("wrapInRow", () => {
  it("wraps a content block in row → column structure", () => {
    const content: TemplateBlock = { id: "s1", type: "header", settings: {} };
    const row = wrapInRow(content);

    expect(row.type).toBe("row");
    expect(row.columnWidths).toEqual([100]);
    expect(row.children).toHaveLength(1);
    expect(row.children![0].type).toBe("column");
    expect(row.children![0].children).toHaveLength(1);
    expect(row.children![0].children![0]).toBe(content);
  });
});

// ─── createContentBlock ──────────────────────────────────────────────────────

describe("createContentBlock", () => {
  it("creates a block with the correct type", () => {
    const block = createContentBlock("signature");
    expect(block.type).toBe("signature");
    expect(block.id).toMatch(/^sec_/);
    expect(block.settings).toEqual({});
    expect(block.visibility).toEqual({});
  });
});
