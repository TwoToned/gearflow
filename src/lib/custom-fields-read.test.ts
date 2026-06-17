import { describe, it, expect } from "vitest";
import {
  mapCustomFieldDefinition,
  sortCustomFieldDefinitions,
  type CustomFieldDefinitionRow,
} from "@/lib/custom-fields-read";

describe("custom-fields-read mapper", () => {
  it("converts epoch-ms dates to Date and keeps absent helpText as null", () => {
    const m = mapCustomFieldDefinition({
      id: "cf1",
      organizationId: "org1",
      entityType: "ASSET",
      label: "Rig Number",
      fieldKey: "rigNumber",
      fieldType: "TEXT",
      options: [],
      required: false,
      sortOrder: 0,
      isActive: true,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_005_000,
      // helpText absent
    } as never);
    expect(m.createdAt).toBeInstanceOf(Date);
    expect(m.createdAt?.getTime()).toBe(1_700_000_000_000);
    expect(m.updatedAt?.getTime()).toBe(1_700_000_005_000);
    expect(m.helpText).toBeNull();
    expect(m.entityType).toBe("ASSET");
    expect(m.fieldType).toBe("TEXT");
    expect(m.options).toEqual([]);
  });

  it("coerces Convex-optional columns to their Prisma defaults when absent", () => {
    const m = mapCustomFieldDefinition({
      id: "cf2",
      organizationId: "org1",
      label: "Bare",
      fieldKey: "bare",
      // entityType, fieldType, options, required, sortOrder, isActive, dates all absent
    } as never);
    expect(m.entityType).toBe("ASSET");
    expect(m.fieldType).toBe("TEXT");
    expect(m.options).toEqual([]);
    expect(m.required).toBe(false);
    expect(m.sortOrder).toBe(0);
    expect(m.isActive).toBe(true);
    expect(m.createdAt).toBeNull();
    expect(m.updatedAt).toBeNull();
  });

  it("passes through SELECT options + helpText + non-default flags", () => {
    const m = mapCustomFieldDefinition({
      id: "cf3",
      organizationId: "org1",
      entityType: "PROJECT",
      label: "Priority",
      fieldKey: "priority",
      fieldType: "SELECT",
      options: ["Low", "High"],
      required: true,
      helpText: "pick one",
      sortOrder: 3,
      isActive: false,
      createdAt: 1,
      updatedAt: 2,
    } as never);
    expect(m.entityType).toBe("PROJECT");
    expect(m.fieldType).toBe("SELECT");
    expect(m.options).toEqual(["Low", "High"]);
    expect(m.required).toBe(true);
    expect(m.helpText).toBe("pick one");
    expect(m.isActive).toBe(false);
    expect(m.sortOrder).toBe(3);
  });
});

describe("sortCustomFieldDefinitions", () => {
  const row = (
    partial: Partial<CustomFieldDefinitionRow> & { id: string },
  ): CustomFieldDefinitionRow => ({
    id: partial.id,
    organizationId: "org",
    entityType: "ASSET",
    label: partial.id,
    fieldKey: partial.id,
    fieldType: "TEXT",
    options: [],
    required: false,
    helpText: null,
    sortOrder: partial.sortOrder ?? 0,
    isActive: partial.isActive ?? true,
    createdAt: partial.createdAt ?? null,
    updatedAt: null,
  });

  it("orders by sortOrder asc, then createdAt asc (matches Prisma orderBy)", () => {
    const defs = [
      row({ id: "third", sortOrder: 2 }),
      row({ id: "first", sortOrder: 0 }),
      row({ id: "second", sortOrder: 1 }),
    ];
    expect(sortCustomFieldDefinitions(defs).map((d) => d.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("breaks sortOrder ties by createdAt ascending", () => {
    const defs = [
      row({ id: "newer", sortOrder: 0, createdAt: new Date(2000) }),
      row({ id: "older", sortOrder: 0, createdAt: new Date(1000) }),
    ];
    expect(sortCustomFieldDefinitions(defs).map((d) => d.id)).toEqual([
      "older",
      "newer",
    ]);
  });

  it("does not mutate the input array", () => {
    const defs = [row({ id: "b", sortOrder: 1 }), row({ id: "a", sortOrder: 0 })];
    const original = defs.map((d) => d.id);
    sortCustomFieldDefinitions(defs);
    expect(defs.map((d) => d.id)).toEqual(original);
  });
});
