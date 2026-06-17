/**
 * Unit tests for the pure group-template parent mappers/sorters.
 *
 * These cover the Convex→Prisma parent-shape mapping and the `orderBy:
 * { name: "asc" }` replication that back `getGroupTemplates` (Phase A
 * read-rewiring). The child `items` come from Prisma and aren't exercised here —
 * the safety property tested is the PARENT shape: epoch-ms→Date, absent
 * description→null, system fields stripped, deterministic name-asc ordering.
 */
import { describe, it, expect } from "vitest";
import {
  mapGroupTemplate,
  sortGroupTemplatesByName,
  type ConvexGroupTemplate,
} from "@/lib/group-templates-read";

function doc(over: Partial<ConvexGroupTemplate>): ConvexGroupTemplate {
  return {
    _id: "convex_id" as ConvexGroupTemplate["_id"],
    _creationTime: 123,
    id: "gt1",
    organizationId: "org1",
    name: "Template",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    ...over,
  } as ConvexGroupTemplate;
}

describe("mapGroupTemplate", () => {
  it("strips _id/_creationTime and converts epoch-ms timestamps to Date", () => {
    const m = mapGroupTemplate(doc({}));
    expect(m).not.toHaveProperty("_id");
    expect(m).not.toHaveProperty("_creationTime");
    expect(m.createdAt).toBeInstanceOf(Date);
    expect(m.updatedAt).toBeInstanceOf(Date);
    expect(m.createdAt.getTime()).toBe(1_700_000_000_000);
    expect(m.updatedAt.getTime()).toBe(1_700_000_500_000);
  });

  it("coerces absent description to null", () => {
    expect(mapGroupTemplate(doc({ description: undefined })).description).toBeNull();
    expect(mapGroupTemplate(doc({ description: "x" })).description).toBe("x");
  });

  it("falls back to epoch 0 when timestamps are absent (legacy mirrored rows)", () => {
    const m = mapGroupTemplate(doc({ createdAt: undefined, updatedAt: undefined }));
    expect(m.createdAt.getTime()).toBe(0);
    expect(m.updatedAt.getTime()).toBe(0);
  });

  it("preserves required scalars", () => {
    const m = mapGroupTemplate(doc({ id: "abc", organizationId: "o9", name: "Rig" }));
    expect(m).toMatchObject({ id: "abc", organizationId: "o9", name: "Rig" });
  });
});

describe("sortGroupTemplatesByName", () => {
  const make = (id: string, name: string) =>
    mapGroupTemplate(doc({ id, name }));

  it("sorts by name ascending", () => {
    const sorted = sortGroupTemplatesByName([
      make("a", "Zulu"),
      make("b", "Alpha"),
      make("c", "Mike"),
    ]);
    expect(sorted.map((t) => t.name)).toEqual(["Alpha", "Mike", "Zulu"]);
  });

  it("is a stable total order — ties broken by id", () => {
    const sorted = sortGroupTemplatesByName([
      make("z", "Same"),
      make("a", "Same"),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["a", "z"]);
  });

  it("does not mutate the input array", () => {
    const input = [make("a", "B"), make("b", "A")];
    const copy = [...input];
    sortGroupTemplatesByName(input);
    expect(input).toEqual(copy);
  });
});
