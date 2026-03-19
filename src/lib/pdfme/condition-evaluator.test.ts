import { describe, it, expect } from "vitest";
import {
  evaluateCondition,
  evaluateVisibility,
  filterVisibleSections,
  isAllowedConditionField,
  getAllowedConditionFields,
} from "./condition-evaluator";
import type { DocumentData } from "./types";
import type { TemplateSection, VisibilityCondition, SectionVisibility } from "./section-types";

const sampleData = {
  org_name: "Acme",
  client_name: "Jane",
  client_phone: "",
  venue_name: "Opera House",
  subtotal: "$1000",
  discount_percent: "",
  total_items: "0",
} as unknown as DocumentData;

// ---------------------------------------------------------------------------
// isAllowedConditionField / getAllowedConditionFields
// ---------------------------------------------------------------------------
describe("isAllowedConditionField", () => {
  it("returns true for allowed fields", () => {
    expect(isAllowedConditionField("client_name")).toBe(true);
    expect(isAllowedConditionField("org_name")).toBe(true);
    expect(isAllowedConditionField("total")).toBe(true);
  });

  it("returns false for disallowed fields", () => {
    expect(isAllowedConditionField("__proto__")).toBe(false);
    expect(isAllowedConditionField("constructor")).toBe(false);
    expect(isAllowedConditionField("random_field")).toBe(false);
  });
});

describe("getAllowedConditionFields", () => {
  it("returns sorted array of field names", () => {
    const fields = getAllowedConditionFields();
    expect(fields.length).toBeGreaterThan(0);
    const sorted = [...fields].sort();
    expect(fields).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// evaluateCondition
// ---------------------------------------------------------------------------
describe("evaluateCondition", () => {
  it("exists: returns true when field has a value", () => {
    expect(evaluateCondition({ field: "client_name", operator: "exists" }, sampleData)).toBe(true);
  });

  it("exists: returns false when field is empty string", () => {
    expect(evaluateCondition({ field: "client_phone", operator: "exists" }, sampleData)).toBe(false);
  });

  it("exists: returns false when field is missing/undefined", () => {
    expect(evaluateCondition({ field: "site_contact_name", operator: "exists" }, sampleData)).toBe(false);
  });

  it("not_exists: returns true when field is empty", () => {
    expect(evaluateCondition({ field: "client_phone", operator: "not_exists" }, sampleData)).toBe(true);
  });

  it("not_exists: returns false when field has value", () => {
    expect(evaluateCondition({ field: "client_name", operator: "not_exists" }, sampleData)).toBe(false);
  });

  it("equals: matches string value", () => {
    expect(
      evaluateCondition({ field: "client_name", operator: "equals", value: "Jane" }, sampleData)
    ).toBe(true);
  });

  it("equals: does not match different value", () => {
    expect(
      evaluateCondition({ field: "client_name", operator: "equals", value: "John" }, sampleData)
    ).toBe(false);
  });

  it("not_equals: returns true for different value", () => {
    expect(
      evaluateCondition({ field: "client_name", operator: "not_equals", value: "John" }, sampleData)
    ).toBe(true);
  });

  it("not_equals: returns false for matching value", () => {
    expect(
      evaluateCondition({ field: "client_name", operator: "not_equals", value: "Jane" }, sampleData)
    ).toBe(false);
  });

  it("returns false for unknown/disallowed fields (security)", () => {
    expect(
      evaluateCondition({ field: "__proto__", operator: "exists" }, sampleData)
    ).toBe(false);
    expect(
      evaluateCondition({ field: "constructor", operator: "exists" }, sampleData)
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateVisibility
// ---------------------------------------------------------------------------
describe("evaluateVisibility", () => {
  it("returns true with empty visibility (show for all)", () => {
    expect(evaluateVisibility({}, "quote", sampleData)).toBe(true);
  });

  it("returns true when docType is in docTypes list", () => {
    expect(
      evaluateVisibility({ docTypes: ["quote", "invoice"] }, "quote", sampleData)
    ).toBe(true);
  });

  it("returns false when docType is not in docTypes list", () => {
    expect(
      evaluateVisibility({ docTypes: ["invoice"] }, "quote", sampleData)
    ).toBe(false);
  });

  it("returns true when docTypes is empty array (show for all)", () => {
    expect(evaluateVisibility({ docTypes: [] }, "quote", sampleData)).toBe(true);
  });

  it("evaluates data condition when docType matches", () => {
    expect(
      evaluateVisibility(
        { condition: { field: "client_name", operator: "exists" } },
        "quote",
        sampleData
      )
    ).toBe(true);
  });

  it("returns false when docType matches but condition fails", () => {
    expect(
      evaluateVisibility(
        { condition: { field: "client_phone", operator: "exists" } },
        "quote",
        sampleData
      )
    ).toBe(false);
  });

  it("returns false when docType doesn't match even if condition passes", () => {
    expect(
      evaluateVisibility(
        {
          docTypes: ["invoice"],
          condition: { field: "client_name", operator: "exists" },
        },
        "quote",
        sampleData
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterVisibleSections
// ---------------------------------------------------------------------------
describe("filterVisibleSections", () => {
  const sections: TemplateSection[] = [
    {
      id: "s1",
      type: "header",
      settings: {} as never,
      visibility: {},
      order: 0,
    },
    {
      id: "s2",
      type: "totals",
      settings: {} as never,
      visibility: { docTypes: ["invoice"] },
      order: 1,
    },
    {
      id: "s3",
      type: "notes",
      settings: {} as never,
      visibility: { condition: { field: "client_phone", operator: "exists" } },
      order: 2,
    },
  ];

  it("filters out sections by doc type", () => {
    const visible = filterVisibleSections(sections, "quote", sampleData);
    expect(visible.map((s) => s.id)).toEqual(["s1"]);
  });

  it("includes sections matching doc type", () => {
    const visible = filterVisibleSections(sections, "invoice", sampleData);
    expect(visible.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("returns empty array if nothing is visible", () => {
    const allHidden: TemplateSection[] = [
      {
        id: "s1",
        type: "header",
        settings: {} as never,
        visibility: { docTypes: ["call-sheet"] },
        order: 0,
      },
    ];
    const visible = filterVisibleSections(allHidden, "quote", sampleData);
    expect(visible).toHaveLength(0);
  });
});
