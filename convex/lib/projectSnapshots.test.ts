// @vitest-environment node
//
// convex/lib/projectSnapshots.ts — the auto-capture "is the live state
// identical to an already-captured snapshot" check (#1080/#1089, Phase 2).
// `snapshotEntriesEqual`/`entryDataEqual` are a Convex-bundle-local copy of
// the same comparison `src/lib/project-snapshot-diff.ts`'s `diffSnapshotEntries`
// makes for the Versions UI (the Convex bundler can't resolve the `@/` alias —
// same pattern as `projectWindow.ts`, pinned here the same way.
import { describe, test, expect } from "vitest";
import { snapshotEntriesEqual, entryDataEqual, type SnapshotEntryLike } from "./projectSnapshots";
import { diffSnapshotEntries } from "@/lib/project-snapshot-diff";

describe("snapshotEntriesEqual byte-for-byte pin against src/lib/project-snapshot-diff", () => {
  const base: SnapshotEntryLike[] = [
    { entityType: "project", entityId: "p1", data: { name: "Gig", total: 110 } },
    { entityType: "lineItem", entityId: "l1", data: { unitPrice: 100, quantity: 1, updatedAt: 1 } },
    { entityType: "group", entityId: "g1", data: { price: 50 } },
  ];

  test("identical lists (module-local + updatedAt-only drift) agree with a zero-length diff", () => {
    const sameButNewerUpdatedAt: SnapshotEntryLike[] = [
      base[0],
      { ...base[1], data: { ...base[1].data, updatedAt: 999 } },
      base[2],
    ];
    expect(snapshotEntriesEqual(base, sameButNewerUpdatedAt)).toBe(true);
    expect(diffSnapshotEntries(base, sameButNewerUpdatedAt)).toHaveLength(0);
  });

  test("a changed line item price disagrees on both sides", () => {
    const drifted: SnapshotEntryLike[] = [base[0], { ...base[1], data: { ...base[1].data, unitPrice: 999 } }, base[2]];
    expect(snapshotEntriesEqual(base, drifted)).toBe(false);
    expect(diffSnapshotEntries(base, drifted).length).toBeGreaterThan(0);
  });

  test("an added entity disagrees on both sides", () => {
    const withExtra: SnapshotEntryLike[] = [...base, { entityType: "lineItem", entityId: "l2", data: { unitPrice: 5 } }];
    expect(snapshotEntriesEqual(base, withExtra)).toBe(false);
    expect(diffSnapshotEntries(base, withExtra).length).toBeGreaterThan(0);
  });

  test("a removed entity disagrees on both sides", () => {
    const withoutGroup = base.filter((e) => e.entityType !== "group");
    expect(snapshotEntriesEqual(base, withoutGroup)).toBe(false);
    expect(diffSnapshotEntries(base, withoutGroup).length).toBeGreaterThan(0);
  });

  test("project-entity-only drift is ignored by both (excluded from the comparison)", () => {
    const projectDrifted: SnapshotEntryLike[] = [
      { entityType: "project", entityId: "p1", data: { name: "Different Gig", total: 999 } },
      base[1],
      base[2],
    ];
    expect(snapshotEntriesEqual(base, projectDrifted)).toBe(true);
    expect(diffSnapshotEntries(base, projectDrifted)).toHaveLength(0);
  });

  test("entryDataEqual ignores updatedAt/createdAt, disagrees on everything else", () => {
    expect(entryDataEqual({ a: 1, updatedAt: 1 }, { a: 1, updatedAt: 2 })).toBe(true);
    expect(entryDataEqual({ a: 1, createdAt: 1 }, { a: 1, createdAt: 2 })).toBe(true);
    expect(entryDataEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});
