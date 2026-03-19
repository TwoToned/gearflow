import { describe, it, expect } from "vitest";
import {
  createDocumentTemplateSchema,
  updateDocumentTemplateSchema,
  DOCUMENT_TYPES,
} from "./document-template";

// ---------------------------------------------------------------------------
// createDocumentTemplateSchema
// ---------------------------------------------------------------------------
describe("createDocumentTemplateSchema", () => {
  const validData = {
    name: "Standard Quote",
    type: "quote" as const,
    basePdf: '{"width":210,"height":297}',
    schemas: '[{"field":"clientName","type":"text"}]',
  };

  // --- valid data ---
  it("accepts valid complete data", () => {
    const result = createDocumentTemplateSchema.parse(validData);
    expect(result.name).toBe("Standard Quote");
    expect(result.type).toBe("quote");
    expect(result.basePdf).toBe('{"width":210,"height":297}');
    expect(result.schemas).toBe('[{"field":"clientName","type":"text"}]');
  });

  // --- required fields ---
  it("rejects missing name", () => {
    const { name: _, ...rest } = validData;
    const result = createDocumentTemplateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = createDocumentTemplateSchema.safeParse({ ...validData, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing type", () => {
    const { type: _, ...rest } = validData;
    const result = createDocumentTemplateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing basePdf", () => {
    const { basePdf: _, ...rest } = validData;
    const result = createDocumentTemplateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing schemas", () => {
    const { schemas: _, ...rest } = validData;
    const result = createDocumentTemplateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  // --- max length ---
  it("rejects name over 100 characters", () => {
    const result = createDocumentTemplateSchema.safeParse({ ...validData, name: "N".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts name exactly 100 characters", () => {
    const result = createDocumentTemplateSchema.safeParse({ ...validData, name: "N".repeat(100) });
    expect(result.success).toBe(true);
  });

  // --- enum validation ---
  it("rejects invalid document type", () => {
    const result = createDocumentTemplateSchema.safeParse({ ...validData, type: "receipt" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid document types", () => {
    for (const type of DOCUMENT_TYPES) {
      const result = createDocumentTemplateSchema.safeParse({ ...validData, type });
      expect(result.success).toBe(true);
    }
  });

  it("covers all expected document types", () => {
    expect(DOCUMENT_TYPES).toEqual([
      "quote",
      "invoice",
      "packing-list",
      "return-sheet",
      "delivery-docket",
      "call-sheet",
    ]);
  });

  // --- edge cases ---
  it("accepts empty string for basePdf (no min length)", () => {
    const result = createDocumentTemplateSchema.safeParse({ ...validData, basePdf: "" });
    expect(result.success).toBe(true);
  });

  it("accepts empty string for schemas (no min length)", () => {
    const result = createDocumentTemplateSchema.safeParse({ ...validData, schemas: "" });
    expect(result.success).toBe(true);
  });

  it("accepts single-character name", () => {
    const result = createDocumentTemplateSchema.parse({ ...validData, name: "Q" });
    expect(result.name).toBe("Q");
  });
});

// ---------------------------------------------------------------------------
// updateDocumentTemplateSchema
// ---------------------------------------------------------------------------
describe("updateDocumentTemplateSchema", () => {
  const validMinimal = { id: "template-1" };

  const validComplete = {
    id: "template-1",
    name: "Updated Quote Template",
    basePdf: '{"width":210,"height":297}',
    schemas: '[{"field":"total","type":"number"}]',
  };

  // --- valid data ---
  it("accepts valid minimal data (id only)", () => {
    const result = updateDocumentTemplateSchema.parse(validMinimal);
    expect(result.id).toBe("template-1");
    expect(result.name).toBeUndefined();
    expect(result.basePdf).toBeUndefined();
    expect(result.schemas).toBeUndefined();
  });

  it("accepts valid complete data", () => {
    const result = updateDocumentTemplateSchema.parse(validComplete);
    expect(result.id).toBe("template-1");
    expect(result.name).toBe("Updated Quote Template");
    expect(result.basePdf).toBe('{"width":210,"height":297}');
    expect(result.schemas).toBe('[{"field":"total","type":"number"}]');
  });

  // --- required fields ---
  it("rejects missing id", () => {
    const result = updateDocumentTemplateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty id", () => {
    const result = updateDocumentTemplateSchema.safeParse({ id: "" });
    expect(result.success).toBe(false);
  });

  // --- max length ---
  it("rejects name over 100 characters", () => {
    const result = updateDocumentTemplateSchema.safeParse({ id: "t1", name: "N".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts name exactly 100 characters", () => {
    const result = updateDocumentTemplateSchema.safeParse({ id: "t1", name: "N".repeat(100) });
    expect(result.success).toBe(true);
  });

  // --- optional fields ---
  it("accepts only name update", () => {
    const result = updateDocumentTemplateSchema.parse({ id: "t1", name: "New Name" });
    expect(result.name).toBe("New Name");
    expect(result.basePdf).toBeUndefined();
    expect(result.schemas).toBeUndefined();
  });

  it("accepts only basePdf update", () => {
    const result = updateDocumentTemplateSchema.parse({ id: "t1", basePdf: "{}" });
    expect(result.basePdf).toBe("{}");
    expect(result.name).toBeUndefined();
  });

  it("accepts only schemas update", () => {
    const result = updateDocumentTemplateSchema.parse({ id: "t1", schemas: "[]" });
    expect(result.schemas).toBe("[]");
    expect(result.name).toBeUndefined();
  });

  // --- edge cases ---
  it("rejects empty name when provided", () => {
    const result = updateDocumentTemplateSchema.safeParse({ id: "t1", name: "" });
    expect(result.success).toBe(false);
  });

  it("accepts empty basePdf string", () => {
    const result = updateDocumentTemplateSchema.safeParse({ id: "t1", basePdf: "" });
    expect(result.success).toBe(true);
  });

  it("accepts empty schemas string", () => {
    const result = updateDocumentTemplateSchema.safeParse({ id: "t1", schemas: "" });
    expect(result.success).toBe(true);
  });

  it("does not have a type field (type is immutable)", () => {
    const result = updateDocumentTemplateSchema.parse({ id: "t1", type: "invoice" } as Record<string, unknown>);
    expect((result as Record<string, unknown>).type).toBeUndefined();
  });
});
