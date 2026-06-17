/**
 * Unit tests for the pure filter/sort predicates in check-items-read.
 *
 * These replicate the Prisma `orderBy` clauses the Convex reads replace:
 *  - the check-item library: `orderBy: [{ category: "asc" }, { label: "asc" }]`
 *    (Postgres ASC ⇒ NULLS LAST on the nullable `category`).
 *  - the model/kit assignment lists: `orderBy: { sortOrder: "asc" }`.
 */
import { describe, it, expect } from "vitest";
import {
  sortCheckItemsForLibrary,
  sortAssignmentsBySortOrder,
  type CheckItemRow,
} from "@/lib/check-items-read";

function ci(partial: Partial<CheckItemRow> & { id: string }): CheckItemRow {
  return {
    organizationId: "org1",
    label: partial.label ?? "Label",
    description: null,
    type: "PASS_FAIL",
    category: null,
    measurementUnit: null,
    measurementMin: null,
    measurementMax: null,
    dropdownOptions: null,
    createdById: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  };
}

describe("sortCheckItemsForLibrary", () => {
  it("sorts by category ASC then label ASC", () => {
    const sorted = sortCheckItemsForLibrary([
      ci({ id: "b", category: "Electrical", label: "Beta" }),
      ci({ id: "a", category: "Electrical", label: "Alpha" }),
      ci({ id: "c", category: "Audio", label: "Gamma" }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("places null category LAST (Postgres ASC NULLS LAST)", () => {
    const sorted = sortCheckItemsForLibrary([
      ci({ id: "uncat", category: null, label: "Aaa" }),
      ci({ id: "cat", category: "Zzz", label: "Zzz" }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["cat", "uncat"]);
  });

  it("breaks category ties on label ASC", () => {
    const sorted = sortCheckItemsForLibrary([
      ci({ id: "y", category: null, label: "Yankee" }),
      ci({ id: "x", category: null, label: "Xray" }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["x", "y"]);
  });

  it("does not mutate the input array", () => {
    const input = [ci({ id: "b", label: "B" }), ci({ id: "a", label: "A" })];
    const before = input.map((i) => i.id);
    sortCheckItemsForLibrary(input);
    expect(input.map((i) => i.id)).toEqual(before);
  });
});

describe("sortAssignmentsBySortOrder", () => {
  it("sorts ascending by sortOrder", () => {
    const sorted = sortAssignmentsBySortOrder([
      { id: "c", sortOrder: 2 },
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1 },
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      { id: "b", sortOrder: 1 },
      { id: "a", sortOrder: 0 },
    ];
    sortAssignmentsBySortOrder(input);
    expect(input.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
