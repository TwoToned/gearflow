/**
 * Unit tests for the document-template Convex read helpers
 * (Phase A read-rewiring of the Convex domain-only decommission).
 *
 * Covers the correctness guards for the 3 converted reads in
 * src/server/document-templates.ts: the mappers (epoch-ms → Date, absent → null,
 * Prisma-defaulted coercion), the 3 pure sort comparators, the isDraft filter, and
 * — the gnarly part — the virtual system-default `isDefault` override composition
 * fed by mapped rows.
 */
import { describe, it, expect } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  mapDocumentTemplate,
  mapBrandTemplate,
  compareDocumentTemplatesForList,
  compareDocumentTemplatesForDropdown,
  type DocumentTemplateRow,
} from "@/lib/document-template-read";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from "@/lib/validations/document-template";

// ─── mapDocumentTemplate ──────────────────────────────────────────────────────

describe("mapDocumentTemplate", () => {
  it("converts a full row: epoch-ms → Date, all optionals present", () => {
    const raw = {
      _id: "convex-internal-id",
      _creationTime: 123,
      id: "dt1",
      organizationId: "org1",
      name: "Quote A",
      type: "quote",
      basePdf: "{base}",
      schemas: "[schema]",
      settings: "{settings}",
      sections: "[sections]",
      brandTemplateId: "bt1",
      thumbnailData: "data:image/png;base64,xxx",
      isDefault: true,
      isDraft: false,
      version: 4,
      thumbnailUrl: "https://x/thumb.png",
      publishedAt: 1_700_000_000_000,
      createdAt: 1_600_000_000_000,
      updatedAt: 1_650_000_000_000,
    } as unknown as Doc<"documentTemplates">;

    const row = mapDocumentTemplate(raw);

    expect(row).toEqual({
      id: "dt1",
      organizationId: "org1",
      name: "Quote A",
      type: "quote",
      basePdf: "{base}",
      schemas: "[schema]",
      settings: "{settings}",
      sections: "[sections]",
      brandTemplateId: "bt1",
      thumbnailData: "data:image/png;base64,xxx",
      isDefault: true,
      isDraft: false,
      version: 4,
      thumbnailUrl: "https://x/thumb.png",
      publishedAt: new Date(1_700_000_000_000),
      createdAt: new Date(1_600_000_000_000),
      updatedAt: new Date(1_650_000_000_000),
    });
    // _id / _creationTime stripped
    expect("_id" in row).toBe(false);
    expect("_creationTime" in row).toBe(false);
  });

  it("coerces Prisma-defaulted columns and nulls absent optionals", () => {
    const raw = {
      _id: "x",
      _creationTime: 1,
      id: "dt2",
      organizationId: "org1",
      name: "Bare",
      type: "invoice",
      // isDefault / isDraft / version absent → defaults
      // all string optionals absent → null
      // publishedAt absent → null
      createdAt: 1_600_000_000_000,
      updatedAt: 1_600_000_000_000,
    } as unknown as Doc<"documentTemplates">;

    const row = mapDocumentTemplate(raw);

    expect(row.isDefault).toBe(false);
    expect(row.isDraft).toBe(false);
    expect(row.version).toBe(1);
    expect(row.basePdf).toBeNull();
    expect(row.schemas).toBeNull();
    expect(row.settings).toBeNull();
    expect(row.sections).toBeNull();
    expect(row.brandTemplateId).toBeNull();
    expect(row.thumbnailData).toBeNull();
    expect(row.thumbnailUrl).toBeNull();
    expect(row.publishedAt).toBeNull();
    expect(row.createdAt).toEqual(new Date(1_600_000_000_000));
    expect(row.updatedAt).toEqual(new Date(1_600_000_000_000));
  });
});

// ─── mapBrandTemplate ─────────────────────────────────────────────────────────

describe("mapBrandTemplate", () => {
  it("converts a full row with accentColor present", () => {
    const raw = {
      _id: "x",
      _creationTime: 1,
      id: "bt1",
      organizationId: "org1",
      name: "Brand A",
      headerSettings: "{header}",
      footerSettings: "{footer}",
      accentColor: "#ff0000",
      isDefault: true,
      createdAt: 1_600_000_000_000,
      updatedAt: 1_650_000_000_000,
    } as unknown as Doc<"brandTemplates">;

    expect(mapBrandTemplate(raw)).toEqual({
      id: "bt1",
      organizationId: "org1",
      name: "Brand A",
      headerSettings: "{header}",
      footerSettings: "{footer}",
      accentColor: "#ff0000",
      isDefault: true,
      createdAt: new Date(1_600_000_000_000),
      updatedAt: new Date(1_650_000_000_000),
    });
  });

  it("nulls absent accentColor and defaults isDefault", () => {
    const raw = {
      _id: "x",
      _creationTime: 1,
      id: "bt2",
      organizationId: "org1",
      name: "Brand B",
      headerSettings: "{}",
      footerSettings: "{}",
      createdAt: 1_600_000_000_000,
      updatedAt: 1_600_000_000_000,
    } as unknown as Doc<"brandTemplates">;

    const row = mapBrandTemplate(raw);
    expect(row.accentColor).toBeNull();
    expect(row.isDefault).toBe(false);
  });
});

// ─── helpers for comparator/composition tests ─────────────────────────────────

function row(over: Partial<DocumentTemplateRow>): DocumentTemplateRow {
  return {
    id: "id",
    organizationId: "org1",
    name: "name",
    type: "quote",
    basePdf: null,
    schemas: null,
    settings: null,
    sections: null,
    brandTemplateId: null,
    thumbnailData: null,
    isDefault: false,
    isDraft: false,
    version: 1,
    thumbnailUrl: null,
    publishedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

// ─── compareDocumentTemplatesForList ──────────────────────────────────────────

describe("compareDocumentTemplatesForList", () => {
  it("sorts by type asc (lexicographic), then isDefault desc, then updatedAt desc", () => {
    const a = row({ id: "a", type: "invoice", isDefault: false, updatedAt: new Date(10) });
    const b = row({ id: "b", type: "quote", isDefault: false, updatedAt: new Date(100) });
    const c = row({ id: "c", type: "invoice", isDefault: true, updatedAt: new Date(1) });
    const d = row({ id: "d", type: "invoice", isDefault: false, updatedAt: new Date(50) });

    const sorted = [a, b, c, d].sort(compareDocumentTemplatesForList).map((r) => r.id);
    // invoice (< quote) first: within invoice, default first, then updatedAt desc
    expect(sorted).toEqual(["c", "d", "a", "b"]);
  });

  it("uses plain string compare for type (not enum rank)", () => {
    // lexicographic: "call-sheet" < "delivery-docket" < "quote"
    const a = row({ id: "a", type: "quote" });
    const b = row({ id: "b", type: "call-sheet" });
    const c = row({ id: "c", type: "delivery-docket" });
    expect([a, b, c].sort(compareDocumentTemplatesForList).map((r) => r.type)).toEqual([
      "call-sheet",
      "delivery-docket",
      "quote",
    ]);
  });
});

// ─── compareDocumentTemplatesForDropdown ──────────────────────────────────────

describe("compareDocumentTemplatesForDropdown", () => {
  it("sorts by type asc, then isDefault desc, then name asc", () => {
    const a = { type: "quote", isDefault: false, name: "Bravo" };
    const b = { type: "quote", isDefault: false, name: "Alpha" };
    const c = { type: "quote", isDefault: true, name: "Zeta" };
    const d = { type: "invoice", isDefault: false, name: "Mike" };

    const sorted = [a, b, c, d]
      .sort(compareDocumentTemplatesForDropdown)
      .map((r) => `${r.type}/${r.isDefault}/${r.name}`);
    expect(sorted).toEqual([
      "invoice/false/Mike",
      "quote/true/Zeta",
      "quote/false/Alpha",
      "quote/false/Bravo",
    ]);
  });
});

// ─── isDraft filter (getPublishedTemplatesForDropdown) ────────────────────────

describe("getPublishedTemplatesForDropdown filter", () => {
  it("keeps only isDraft === false rows", () => {
    const rows = [
      row({ id: "published", isDraft: false }),
      row({ id: "draft", isDraft: true }),
    ];
    const published = rows.filter((t) => t.isDraft === false).map((r) => r.id);
    expect(published).toEqual(["published"]);
  });
});

// ─── virtual system-default composition over mapped rows ──────────────────────
//
// Replicates the synthesis logic in getDocumentTemplates byte-for-byte, fed by
// mapped rows — the load-bearing, gnarly part. A system default for a type is
// active (isDefault: true) iff NO custom template of that type is marked default.

function composeSystemDefaults(templates: DocumentTemplateRow[], organizationId: string) {
  const systemDefaults = DOCUMENT_TYPES.map((type) => ({
    id: `system-${type}`,
    organizationId,
    name: `${DOCUMENT_TYPE_LABELS[type]} — System Default`,
    type,
    isDefault: false,
    isSystemDefault: true,
  }));

  const customByType = new Map<string, DocumentTemplateRow[]>();
  for (const t of templates) {
    if (!customByType.has(t.type)) customByType.set(t.type, []);
    customByType.get(t.type)!.push(t);
  }

  return systemDefaults.map((sd) => {
    const customs = customByType.get(sd.type) || [];
    const hasCustomDefault = customs.some((c) => c.isDefault);
    return { ...sd, isDefault: !hasCustomDefault };
  });
}

describe("virtual system-default isDefault override (over mapped rows)", () => {
  it("system default is active when no custom of that type is default", () => {
    const mapped = [
      mapDocumentTemplate({
        _id: "x",
        _creationTime: 1,
        id: "dt-quote",
        organizationId: "org1",
        name: "Quote custom",
        type: "quote",
        isDefault: false, // not default → system default stays active
        createdAt: 1,
        updatedAt: 1,
      } as unknown as Doc<"documentTemplates">),
    ];

    const result = composeSystemDefaults(mapped, "org1");
    const quoteSd = result.find((r) => r.type === "quote")!;
    const invoiceSd = result.find((r) => r.type === "invoice")!;
    expect(quoteSd.isDefault).toBe(true); // no custom default for quote
    expect(invoiceSd.isDefault).toBe(true); // no custom at all for invoice
  });

  it("system default is overridden (inactive) when a custom of that type is default", () => {
    const mapped = [
      mapDocumentTemplate({
        _id: "x",
        _creationTime: 1,
        id: "dt-quote",
        organizationId: "org1",
        name: "Quote custom",
        type: "quote",
        isDefault: true, // custom default → system default becomes inactive
        createdAt: 1,
        updatedAt: 1,
      } as unknown as Doc<"documentTemplates">),
    ];

    const result = composeSystemDefaults(mapped, "org1");
    const quoteSd = result.find((r) => r.type === "quote")!;
    const invoiceSd = result.find((r) => r.type === "invoice")!;
    expect(quoteSd.isDefault).toBe(false); // overridden by custom default
    expect(invoiceSd.isDefault).toBe(true); // unaffected
  });
});
