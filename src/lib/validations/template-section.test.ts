import { describe, it, expect } from "vitest";
import {
  templateSectionSchema,
  templateSectionsSchema,
  sectionTypeSchema,
  visibilityConditionSchema,
  createBrandTemplateSchema,
  updateBrandTemplateSchema,
  saveTemplateSectionsSchema,
  saveTemplateBlocksSchema,
  templateExportSchema,
  templateImportSchema,
  templateBlockSchema,
  templateBlocksSchema,
  blockStylingSchema,
  layoutHintSchema,
  validateSectionSettings,
  SETTINGS_SCHEMA_MAP,
} from "./template-section";

// ---------------------------------------------------------------------------
// sectionTypeSchema
// ---------------------------------------------------------------------------
describe("sectionTypeSchema", () => {
  it("accepts all valid section types", () => {
    const types = [
      "header", "client-details", "project-details", "table", "totals",
      "notes", "signature", "custom-text", "crew-table", "spacer", "page-break",
    ];
    for (const type of types) {
      expect(sectionTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects invalid types", () => {
    expect(sectionTypeSchema.safeParse("foo").success).toBe(false);
    expect(sectionTypeSchema.safeParse("").success).toBe(false);
    expect(sectionTypeSchema.safeParse(123).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// visibilityConditionSchema
// ---------------------------------------------------------------------------
describe("visibilityConditionSchema", () => {
  it("accepts valid condition", () => {
    const result = visibilityConditionSchema.safeParse({
      field: "client_name",
      operator: "exists",
    });
    expect(result.success).toBe(true);
  });

  it("accepts condition with value", () => {
    const result = visibilityConditionSchema.safeParse({
      field: "project_status",
      operator: "equals",
      value: "CONFIRMED",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty field", () => {
    const result = visibilityConditionSchema.safeParse({
      field: "",
      operator: "exists",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid operator", () => {
    const result = visibilityConditionSchema.safeParse({
      field: "client_name",
      operator: "contains",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// templateSectionSchema
// ---------------------------------------------------------------------------
describe("templateSectionSchema", () => {
  const validSection = {
    id: "sec_1",
    type: "header" as const,
    settings: { logoMode: "icon", showOrgName: true },
    visibility: {},
    order: 0,
  };

  it("accepts valid section", () => {
    const result = templateSectionSchema.safeParse(validSection);
    expect(result.success).toBe(true);
  });

  it("accepts section with content", () => {
    const result = templateSectionSchema.safeParse({
      ...validSection,
      type: "custom-text",
      content: "Hello {client_name}",
    });
    expect(result.success).toBe(true);
  });

  it("rejects section without id", () => {
    const { id: _, ...rest } = validSection;
    expect(templateSectionSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects section with invalid type", () => {
    expect(
      templateSectionSchema.safeParse({ ...validSection, type: "invalid" }).success
    ).toBe(false);
  });

  it("rejects content over 5000 chars", () => {
    expect(
      templateSectionSchema.safeParse({
        ...validSection,
        content: "x".repeat(5001),
      }).success
    ).toBe(false);
  });

  it("accepts content exactly 5000 chars", () => {
    expect(
      templateSectionSchema.safeParse({
        ...validSection,
        content: "x".repeat(5000),
      }).success
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// templateSectionsSchema
// ---------------------------------------------------------------------------
describe("templateSectionsSchema", () => {
  const section = {
    id: "s1",
    type: "header" as const,
    settings: {},
    visibility: {},
    order: 0,
  };

  it("accepts array with 1 section", () => {
    expect(templateSectionsSchema.safeParse([section]).success).toBe(true);
  });

  it("rejects empty array", () => {
    expect(templateSectionsSchema.safeParse([]).success).toBe(false);
  });

  it("rejects more than 50 sections", () => {
    const sections = Array.from({ length: 51 }, (_, i) => ({
      ...section,
      id: `s${i}`,
      order: i,
    }));
    expect(templateSectionsSchema.safeParse(sections).success).toBe(false);
  });

  it("accepts exactly 50 sections", () => {
    const sections = Array.from({ length: 50 }, (_, i) => ({
      ...section,
      id: `s${i}`,
      order: i,
    }));
    expect(templateSectionsSchema.safeParse(sections).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createBrandTemplateSchema
// ---------------------------------------------------------------------------
describe("createBrandTemplateSchema", () => {
  const valid = {
    name: "Corporate Brand",
    headerSettings: {
      logoMode: "logo" as const,
      showOrgName: true,
      showOrgAddress: true,
      showOrgPhone: false,
      showOrgEmail: true,
      showOrgWebsite: false,
    },
    footerSettings: {
      showFooter: true,
      primaryText: "All prices exclude GST",
      secondaryText: "Terms apply",
    },
  };

  it("accepts valid data", () => {
    expect(createBrandTemplateSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts with accent color", () => {
    expect(
      createBrandTemplateSchema.safeParse({ ...valid, accentColor: "#1a2b3c" }).success
    ).toBe(true);
  });

  it("rejects invalid hex color", () => {
    expect(
      createBrandTemplateSchema.safeParse({ ...valid, accentColor: "red" }).success
    ).toBe(false);
  });

  it("accepts empty string for accent color", () => {
    expect(
      createBrandTemplateSchema.safeParse({ ...valid, accentColor: "" }).success
    ).toBe(true);
  });

  it("rejects missing name", () => {
    const { name: _, ...rest } = valid;
    expect(createBrandTemplateSchema.safeParse(rest).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// saveTemplateSectionsSchema
// ---------------------------------------------------------------------------
describe("saveTemplateSectionsSchema", () => {
  it("accepts valid data", () => {
    const result = saveTemplateSectionsSchema.safeParse({
      id: "template-1",
      sections: [
        { id: "s1", type: "header", settings: {}, visibility: {}, order: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts with brand template id", () => {
    const result = saveTemplateSectionsSchema.safeParse({
      id: "template-1",
      sections: [
        { id: "s1", type: "header", settings: {}, visibility: {}, order: 0 },
      ],
      brandTemplateId: "brand-1",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null brand template id", () => {
    const result = saveTemplateSectionsSchema.safeParse({
      id: "template-1",
      sections: [
        { id: "s1", type: "header", settings: {}, visibility: {}, order: 0 },
      ],
      brandTemplateId: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const result = saveTemplateSectionsSchema.safeParse({
      sections: [
        { id: "s1", type: "header", settings: {}, visibility: {}, order: 0 },
      ],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// templateExportSchema / templateImportSchema
// ---------------------------------------------------------------------------
describe("templateExportSchema", () => {
  const validExport = {
    version: 1 as const,
    type: "quote" as const,
    name: "My Quote Template",
    sections: [
      { id: "s1", type: "header" as const, settings: {}, visibility: {}, order: 0 },
    ],
    exportedAt: "2026-03-19T10:00:00Z",
  };

  it("accepts valid export data", () => {
    expect(templateExportSchema.safeParse(validExport).success).toBe(true);
  });

  it("rejects wrong version", () => {
    expect(
      templateExportSchema.safeParse({ ...validExport, version: 2 }).success
    ).toBe(false);
  });

  it("rejects invalid document type", () => {
    expect(
      templateExportSchema.safeParse({ ...validExport, type: "receipt" }).success
    ).toBe(false);
  });

  it("templateImportSchema is the same as export", () => {
    expect(templateImportSchema.safeParse(validExport).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateSectionSettings (discriminated union)
// ---------------------------------------------------------------------------
describe("validateSectionSettings", () => {
  it("validates header settings correctly", () => {
    const result = validateSectionSettings("header", {
      logoMode: "icon",
      showOrgName: true,
      showOrgAddress: true,
      showOrgPhone: true,
      showOrgEmail: true,
      showOrgWebsite: true,
      documentTitle: "QUOTE",
    });
    expect(result.success).toBe(true);
  });

  it("rejects header with invalid logoMode", () => {
    const result = validateSectionSettings("header", {
      logoMode: "giant",
      showOrgName: true,
      showOrgAddress: true,
      showOrgPhone: true,
      showOrgEmail: true,
      showOrgWebsite: true,
      documentTitle: "QUOTE",
    });
    expect(result.success).toBe(false);
  });

  it("validates table settings correctly", () => {
    const result = validateSectionSettings("table", {
      showGroupHeaders: true,
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
    expect(result.success).toBe(true);
  });

  it("validates signature settings", () => {
    const result = validateSectionSettings("signature", {
      columns: 2,
      labels: ["Sent By", "Received By"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects signature with too many columns", () => {
    const result = validateSectionSettings("signature", {
      columns: 10,
      labels: ["A"],
    });
    expect(result.success).toBe(false);
  });

  it("validates custom-text settings", () => {
    const result = validateSectionSettings("custom-text", {
      fontSize: 9,
      fontWeight: "bold",
      alignment: "center",
    });
    expect(result.success).toBe(true);
  });

  it("validates spacer settings", () => {
    const result = validateSectionSettings("spacer", { height: 20 });
    expect(result.success).toBe(true);
  });

  it("rejects spacer with height out of range", () => {
    const result = validateSectionSettings("spacer", { height: 200 });
    expect(result.success).toBe(false);
  });

  it("validates page-break (empty settings)", () => {
    const result = validateSectionSettings("page-break", {});
    expect(result.success).toBe(true);
  });

  it("validates client-details with customLabels and customFields", () => {
    const result = validateSectionSettings("client-details", {
      showClientName: true,
      showClientContact: true,
      showClientEmail: true,
      showClientAddress: true,
      showClientTaxId: false,
      customLabels: { contact: "Buyer" },
      customFields: [{ label: "ABN", value: "12 345 678 901" }],
    });
    expect(result.success).toBe(true);
  });

  it("validates crew-table settings", () => {
    const result = validateSectionSettings("crew-table", {
      showPhone: true,
      showEmail: false,
      showNotes: true,
    });
    expect(result.success).toBe(true);
  });

  it("falls back to permissive for unknown type", () => {
    const result = validateSectionSettings("unknown-type", { foo: "bar" });
    expect(result.success).toBe(true);
  });

  it("validates call-sheet-info settings", () => {
    const result = validateSectionSettings("call-sheet-info", {
      showPmContact: true,
      showClientContact: true,
      showVenueDetails: true,
      showScheduleTimes: true,
      showEquipmentSummary: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects call-sheet-info with non-boolean field", () => {
    const result = validateSectionSettings("call-sheet-info", {
      showPmContact: "yes",
      showClientContact: true,
      showVenueDetails: true,
      showScheduleTimes: true,
      showEquipmentSummary: true,
    });
    expect(result.success).toBe(false);
  });

  it("validates day-header settings", () => {
    const result = validateSectionSettings("day-header", {
      showPhases: true,
      showCrewCount: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects day-header with non-boolean field", () => {
    const result = validateSectionSettings("day-header", {
      showPhases: 1,
      showCrewCount: true,
    });
    expect(result.success).toBe(false);
  });

  it("validates every section type has a schema entry", () => {
    const types = [
      "header", "client-details", "project-details", "table", "totals",
      "notes", "signature", "custom-text", "crew-table", "spacer", "page-break",
      "call-sheet-info", "day-header",
    ];
    for (const type of types) {
      expect(SETTINGS_SCHEMA_MAP).toHaveProperty(type);
    }
  });
});

// ---------------------------------------------------------------------------
// blockStylingSchema
// ---------------------------------------------------------------------------
describe("blockStylingSchema", () => {
  it("accepts empty styling", () => {
    expect(blockStylingSchema.safeParse({}).success).toBe(true);
  });

  it("accepts full styling", () => {
    const result = blockStylingSchema.safeParse({
      backgroundColor: "#f5f5f5",
      borderColor: "#dddddd",
      borderWidth: 1,
      padding: 4,
      margin: 2,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid hex color", () => {
    expect(
      blockStylingSchema.safeParse({ backgroundColor: "red" }).success
    ).toBe(false);
  });

  it("rejects negative border width", () => {
    expect(
      blockStylingSchema.safeParse({ borderWidth: -1 }).success
    ).toBe(false);
  });

  it("rejects excessive padding", () => {
    expect(
      blockStylingSchema.safeParse({ padding: 100 }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// layoutHintSchema
// ---------------------------------------------------------------------------
describe("layoutHintSchema", () => {
  it("accepts valid layout hint", () => {
    const result = layoutHintSchema.safeParse({
      rowId: "row_1",
      columnIndex: 0,
      columnWidth: 50,
      columnCount: 2,
    });
    expect(result.success).toBe(true);
  });

  it("accepts layout hint with styling", () => {
    const result = layoutHintSchema.safeParse({
      rowId: "row_1",
      columnIndex: 1,
      columnWidth: 50,
      columnCount: 2,
      styling: { backgroundColor: "#f0f0f0" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects columnIndex > 3", () => {
    expect(
      layoutHintSchema.safeParse({
        rowId: "row_1",
        columnIndex: 4,
        columnWidth: 25,
        columnCount: 5,
      }).success
    ).toBe(false);
  });

  it("rejects columnCount > 4", () => {
    expect(
      layoutHintSchema.safeParse({
        rowId: "row_1",
        columnIndex: 0,
        columnWidth: 20,
        columnCount: 5,
      }).success
    ).toBe(false);
  });

  it("rejects columnWidth > 100", () => {
    expect(
      layoutHintSchema.safeParse({
        rowId: "row_1",
        columnIndex: 0,
        columnWidth: 101,
        columnCount: 1,
      }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// templateBlockSchema
// ---------------------------------------------------------------------------
describe("templateBlockSchema", () => {
  it("accepts a content block (leaf)", () => {
    const result = templateBlockSchema.safeParse({
      id: "blk_1",
      type: "header",
      settings: { logoMode: "icon" },
      visibility: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts a row with column children", () => {
    const result = templateBlockSchema.safeParse({
      id: "row_1",
      type: "row",
      columnWidths: [50, 50],
      children: [
        {
          id: "col_1",
          type: "column",
          children: [
            { id: "blk_1", type: "client-details", settings: {} },
          ],
        },
        {
          id: "col_2",
          type: "column",
          children: [
            { id: "blk_2", type: "project-details", settings: {} },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a single-column row", () => {
    const result = templateBlockSchema.safeParse({
      id: "row_1",
      type: "row",
      columnWidths: [100],
      children: [
        {
          id: "col_1",
          type: "column",
          children: [
            { id: "blk_1", type: "table", settings: {} },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts block with styling", () => {
    const result = templateBlockSchema.safeParse({
      id: "blk_1",
      type: "custom-text",
      content: "Hello world",
      styling: {
        backgroundColor: "#f5f5f5",
        padding: 4,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects block with invalid type", () => {
    expect(
      templateBlockSchema.safeParse({
        id: "blk_1",
        type: "unknown-type",
      }).success
    ).toBe(false);
  });

  it("rejects block without id", () => {
    expect(
      templateBlockSchema.safeParse({ type: "header" }).success
    ).toBe(false);
  });

  it("rejects columnWidths with more than 4 entries", () => {
    expect(
      templateBlockSchema.safeParse({
        id: "row_1",
        type: "row",
        columnWidths: [20, 20, 20, 20, 20],
      }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// templateBlocksSchema
// ---------------------------------------------------------------------------
describe("templateBlocksSchema", () => {
  it("accepts empty array", () => {
    expect(templateBlocksSchema.safeParse([]).success).toBe(true);
  });

  it("accepts array of blocks", () => {
    const result = templateBlocksSchema.safeParse([
      { id: "row_1", type: "row", columnWidths: [100], children: [] },
      { id: "row_2", type: "row", columnWidths: [50, 50], children: [] },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects more than 50 blocks", () => {
    const blocks = Array.from({ length: 51 }, (_, i) => ({
      id: `blk_${i}`,
      type: "header" as const,
    }));
    expect(templateBlocksSchema.safeParse(blocks).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// saveTemplateBlocksSchema
// ---------------------------------------------------------------------------
describe("saveTemplateBlocksSchema", () => {
  it("accepts valid blocks save payload", () => {
    const result = saveTemplateBlocksSchema.safeParse({
      id: "template-1",
      blocks: [
        {
          id: "row_1",
          type: "row",
          columnWidths: [100],
          children: [
            {
              id: "col_1",
              type: "column",
              children: [{ id: "blk_1", type: "header", settings: {} }],
            },
          ],
        },
      ],
      version: 3,
    });
    expect(result.success).toBe(true);
  });

  it("accepts without version (backward compat)", () => {
    const result = saveTemplateBlocksSchema.safeParse({
      id: "template-1",
      blocks: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    expect(
      saveTemplateBlocksSchema.safeParse({ blocks: [] }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// saveTemplateSectionsSchema (with version)
// ---------------------------------------------------------------------------
describe("saveTemplateSectionsSchema with version", () => {
  it("accepts with version number", () => {
    const result = saveTemplateSectionsSchema.safeParse({
      id: "template-1",
      sections: [
        { id: "s1", type: "header", settings: {}, visibility: {}, order: 0 },
      ],
      version: 5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts without version (backward compat)", () => {
    const result = saveTemplateSectionsSchema.safeParse({
      id: "template-1",
      sections: [
        { id: "s1", type: "header", settings: {}, visibility: {}, order: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// templateSectionSchema with layoutHint
// ---------------------------------------------------------------------------
describe("templateSectionSchema with layoutHint", () => {
  it("accepts section with layoutHint", () => {
    const result = templateSectionSchema.safeParse({
      id: "sec_1",
      type: "header",
      settings: {},
      visibility: {},
      order: 0,
      layoutHint: {
        rowId: "row_1",
        columnIndex: 0,
        columnWidth: 100,
        columnCount: 1,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts section without layoutHint (backward compat)", () => {
    const result = templateSectionSchema.safeParse({
      id: "sec_1",
      type: "header",
      settings: {},
      visibility: {},
      order: 0,
    });
    expect(result.success).toBe(true);
  });
});
