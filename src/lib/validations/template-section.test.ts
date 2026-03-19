import { describe, it, expect } from "vitest";
import {
  templateSectionSchema,
  templateSectionsSchema,
  sectionTypeSchema,
  visibilityConditionSchema,
  createBrandTemplateSchema,
  updateBrandTemplateSchema,
  saveTemplateSectionsSchema,
  templateExportSchema,
  templateImportSchema,
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
