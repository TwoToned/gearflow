/**
 * Unit tests for the brand-template Convex read helpers (Phase A read-rewiring of
 * the Convex domain-only decommission).
 *
 * Covers the correctness guards for the 2 converted reads in
 * src/server/brand-templates.ts: the mapper (epoch-ms → Date, absent → null,
 * Prisma-defaulted `isDefault` coercion, non-null createdAt/updatedAt), the pure
 * [isDefault desc, name asc] sort, and the JS org-scope re-application.
 */
import { describe, it, expect } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  mapBrandTemplate,
  compareBrandTemplatesForList,
  matchesOrg,
  type BrandTemplateRow,
} from "@/lib/brand-templates-read";

// ─── mapBrandTemplate ─────────────────────────────────────────────────────────

describe("mapBrandTemplate", () => {
  it("converts a full row: epoch-ms → Date, strips _id/_creationTime", () => {
    const raw = {
      _id: "convex-internal-id",
      _creationTime: 123,
      id: "bt1",
      organizationId: "org1",
      name: "Default Brand",
      headerSettings: '{"logo":"x"}',
      footerSettings: '{"text":"y"}',
      accentColor: "#ff0000",
      isDefault: true,
      createdAt: 1_600_000_000_000,
      updatedAt: 1_650_000_000_000,
    } as unknown as Doc<"brandTemplates">;

    const row = mapBrandTemplate(raw);

    expect(row).toEqual({
      id: "bt1",
      organizationId: "org1",
      name: "Default Brand",
      headerSettings: '{"logo":"x"}',
      footerSettings: '{"text":"y"}',
      accentColor: "#ff0000",
      isDefault: true,
      createdAt: new Date(1_600_000_000_000),
      updatedAt: new Date(1_650_000_000_000),
    });
    expect("_id" in row).toBe(false);
    expect("_creationTime" in row).toBe(false);
  });

  it("coerces Prisma-defaulted isDefault and nulls absent accentColor", () => {
    const raw = {
      _id: "x",
      _creationTime: 1,
      id: "bt2",
      organizationId: "org1",
      name: "Bare",
      headerSettings: "{}",
      footerSettings: "{}",
      // accentColor absent
      // isDefault absent
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    } as unknown as Doc<"brandTemplates">;

    const row = mapBrandTemplate(raw);

    expect(row.accentColor).toBeNull();
    expect(row.isDefault).toBe(false);
    expect(row.createdAt).toEqual(new Date(1_700_000_000_000));
    expect(row.updatedAt).toEqual(new Date(1_700_000_000_000));
  });

  it("passes headerSettings/footerSettings through as raw JSON strings (no parse)", () => {
    const raw = {
      id: "bt3",
      organizationId: "org1",
      name: "JSON",
      headerSettings: '{"a":1}',
      footerSettings: '[1,2,3]',
      createdAt: 1,
      updatedAt: 2,
    } as unknown as Doc<"brandTemplates">;

    const row = mapBrandTemplate(raw);
    expect(row.headerSettings).toBe('{"a":1}');
    expect(row.footerSettings).toBe("[1,2,3]");
  });
});

// ─── compareBrandTemplatesForList ────────────────────────────────────────────

const mk = (over: Partial<BrandTemplateRow>): BrandTemplateRow => ({
  id: "id",
  organizationId: "org1",
  name: "name",
  headerSettings: "{}",
  footerSettings: "{}",
  accentColor: null,
  isDefault: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

describe("compareBrandTemplatesForList", () => {
  it("sorts [isDefault desc, name asc]", () => {
    const rows = [
      mk({ id: "b", name: "Bravo", isDefault: false }),
      mk({ id: "a", name: "Alpha", isDefault: false }),
      mk({ id: "d", name: "Delta", isDefault: true }),
      mk({ id: "c", name: "Charlie", isDefault: true }),
    ];
    const sorted = [...rows].sort(compareBrandTemplatesForList).map((r) => r.id);
    // defaults first (by name asc: Charlie, Delta), then non-defaults (Alpha, Bravo)
    expect(sorted).toEqual(["c", "d", "a", "b"]);
  });

  it("default beats non-default regardless of name", () => {
    const a = mk({ name: "ZZZ", isDefault: true });
    const b = mk({ name: "AAA", isDefault: false });
    expect(compareBrandTemplatesForList(a, b)).toBeLessThan(0);
  });

  it("equal isDefault + equal name → 0", () => {
    expect(compareBrandTemplatesForList(mk({ name: "x" }), mk({ name: "x" }))).toBe(0);
  });
});

// ─── matchesOrg ──────────────────────────────────────────────────────────────

describe("matchesOrg", () => {
  it("true on matching org, false otherwise", () => {
    const row = mk({ organizationId: "org1" });
    expect(matchesOrg(row, "org1")).toBe(true);
    expect(matchesOrg(row, "org2")).toBe(false);
  });
});
