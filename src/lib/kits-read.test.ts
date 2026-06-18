/**
 * Unit tests for the pure kit read-rewiring helpers (Phase A):
 * - `countKitMembers` — the JS per-kit member counter that replaces the two
 *   Prisma `groupBy({ by: ["kitId"] })` calls in getKitCounts.
 * - `coerceKitDeletabilityRow` / `computeKitDeletability` — reproduce the Prisma
 *   column defaults the Convex-optional `status`/`isActive` fields lose, plus the
 *   byte-for-byte port of the `canDeleteKit` decision logic (the ProjectLineItem
 *   reference count is supplied by the caller — it stays on Prisma until the
 *   keystone tree migrates).
 */
import { describe, it, expect } from "vitest";
import {
  countKitMembers,
  coerceKitDeletabilityRow,
  computeKitDeletability,
  type ConvexKit,
} from "@/lib/kits-read";

describe("countKitMembers", () => {
  it("counts serialized + bulk members per kit", () => {
    const serialized = [{ kitId: "k1" }, { kitId: "k1" }, { kitId: "k2" }];
    const bulk = [{ kitId: "k1" }, { kitId: "k3" }];
    expect(countKitMembers(serialized, bulk)).toEqual({
      k1: { serializedItems: 2, bulkItems: 1 },
      k2: { serializedItems: 1, bulkItems: 0 },
      k3: { serializedItems: 0, bulkItems: 1 },
    });
  });

  it("skips rows with a null kitId", () => {
    expect(
      countKitMembers([{ kitId: null }, { kitId: "k1" }], [{ kitId: null }]),
    ).toEqual({ k1: { serializedItems: 1, bulkItems: 0 } });
  });

  it("returns an empty record for empty inputs", () => {
    expect(countKitMembers([], [])).toEqual({});
  });
});

function kit(overrides: Partial<ConvexKit> = {}): ConvexKit {
  return {
    _id: "x" as ConvexKit["_id"],
    _creationTime: 0,
    id: "k1",
    organizationId: "org1",
    assetTag: "K-001",
    name: "Kit",
    status: "AVAILABLE",
    isActive: true,
    ...overrides,
  } as ConvexKit;
}

describe("coerceKitDeletabilityRow", () => {
  it("passes through explicit status/isActive", () => {
    expect(coerceKitDeletabilityRow(kit({ status: "CHECKED_OUT", isActive: false }))).toEqual({
      id: "k1",
      status: "CHECKED_OUT",
      isActive: false,
    });
  });

  it("coerces absent status to AVAILABLE and absent isActive to true (Prisma defaults)", () => {
    expect(
      coerceKitDeletabilityRow(kit({ status: undefined, isActive: undefined })),
    ).toEqual({ id: "k1", status: "AVAILABLE", isActive: true });
  });

  it("keeps isActive=false (a falsey value, not absence)", () => {
    expect(coerceKitDeletabilityRow(kit({ isActive: false })).isActive).toBe(false);
  });
});

describe("computeKitDeletability", () => {
  it("allows archive + hard delete for an AVAILABLE, active, unreferenced kit", () => {
    expect(
      computeKitDeletability({ id: "k1", status: "AVAILABLE", isActive: true }, 0),
    ).toEqual({
      canArchive: true,
      canHardDelete: true,
      referencingLineItems: 0,
      reason: undefined,
    });
  });

  it("allows archive but blocks hard delete when referenced (singular pluralisation)", () => {
    const r = computeKitDeletability({ id: "k1", status: "AVAILABLE", isActive: true }, 1);
    expect(r.canArchive).toBe(true);
    expect(r.canHardDelete).toBe(false);
    expect(r.referencingLineItems).toBe(1);
    expect(r.reason).toBe(
      "Kit is referenced by 1 project line item. Archive it instead, or remove it from those projects first.",
    );
  });

  it("blocks hard delete with plural copy for multiple references", () => {
    const r = computeKitDeletability({ id: "k1", status: "AVAILABLE", isActive: true }, 3);
    expect(r.canHardDelete).toBe(false);
    expect(r.reason).toBe(
      "Kit is referenced by 3 project line items. Archive it instead, or remove it from those projects first.",
    );
  });

  it("blocks both when status is not AVAILABLE, naming the status", () => {
    const r = computeKitDeletability({ id: "k1", status: "CHECKED_OUT", isActive: true }, 0);
    expect(r.canArchive).toBe(false);
    expect(r.canHardDelete).toBe(false);
    expect(r.reason).toBe(
      "Kit status is CHECKED_OUT — only AVAILABLE kits can be archived or deleted.",
    );
  });

  it("reports an already-archived kit when AVAILABLE but inactive", () => {
    const r = computeKitDeletability({ id: "k1", status: "AVAILABLE", isActive: false }, 0);
    expect(r.canArchive).toBe(false);
    expect(r.canHardDelete).toBe(false);
    expect(r.reason).toBe("Kit is already archived.");
  });

  it("status-not-AVAILABLE message takes precedence over the reference message", () => {
    const r = computeKitDeletability({ id: "k1", status: "RETIRED", isActive: true }, 5);
    expect(r.reason).toBe(
      "Kit status is RETIRED — only AVAILABLE kits can be archived or deleted.",
    );
  });
});
