/**
 * Unit test for countKitMembers — the JS per-kit member counter that replaces the
 * two Prisma `groupBy({ by: ["kitId"] })` calls in getKitCounts (Phase A).
 */
import { describe, it, expect } from "vitest";
import { countKitMembers } from "@/lib/kits-read";

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
