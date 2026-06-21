/**
 * Unit tests for the pure projectManager filter/sort (`filterAndSortManagers`).
 *
 * Replaces the Prisma read
 * `findMany({ where: { projectId, organizationId }, orderBy: { addedAt: "asc" } })`.
 * Safety property: identical row set + order — org/project-scoped, ascending by
 * addedAt, with epoch-ms `addedAt` mapped back to a Date.
 */
import { describe, it, expect } from "vitest";
import { filterAndSortManagers, type ConvexProjectManager } from "@/lib/project-managers-read";

function doc(over: Partial<ConvexProjectManager>): ConvexProjectManager {
  return {
    _id: "x" as ConvexProjectManager["_id"],
    _creationTime: 0,
    id: "pm1",
    organizationId: "org1",
    projectId: "proj1",
    userId: "u1",
    addedAt: 1000,
    ...over,
  } as ConvexProjectManager;
}

describe("filterAndSortManagers", () => {
  it("keeps only rows matching both projectId and organizationId", () => {
    const rows = filterAndSortManagers(
      [
        doc({ id: "a", projectId: "proj1", organizationId: "org1" }),
        doc({ id: "b", projectId: "proj2", organizationId: "org1" }),
        doc({ id: "c", projectId: "proj1", organizationId: "org2" }),
      ],
      "proj1",
      "org1",
    );
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("sorts ascending by addedAt", () => {
    const rows = filterAndSortManagers(
      [
        doc({ id: "late", addedAt: 3000 }),
        doc({ id: "early", addedAt: 1000 }),
        doc({ id: "mid", addedAt: 2000 }),
      ],
      "proj1",
      "org1",
    );
    expect(rows.map((r) => r.id)).toEqual(["early", "mid", "late"]);
  });

  it("maps epoch-ms addedAt to a Date and preserves scalar fields", () => {
    const [row] = filterAndSortManagers(
      [doc({ id: "pm9", userId: "u42", addedAt: 1700000000000 })],
      "proj1",
      "org1",
    );
    expect(row).toEqual({
      id: "pm9",
      organizationId: "org1",
      projectId: "proj1",
      userId: "u42",
      addedAt: new Date(1700000000000),
    });
    expect(row.addedAt).toBeInstanceOf(Date);
  });

  it("coerces an absent addedAt to the epoch (Prisma @default(now()) column)", () => {
    const [row] = filterAndSortManagers(
      [doc({ id: "pm0", addedAt: undefined })],
      "proj1",
      "org1",
    );
    expect(row.addedAt).toEqual(new Date(0));
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterAndSortManagers([doc({})], "nope", "org1")).toEqual([]);
  });
});
