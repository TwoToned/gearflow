import { describe, it, expect } from "vitest";
import { mapWarehouseToken } from "./warehouse-display-token-read";

function doc(overrides: Record<string, unknown> = {}) {
  return {
    _id: "convex_internal_id" as never,
    _creationTime: 1_700_000_000_000,
    id: "tok_1",
    organizationId: "org_1",
    name: "Main Warehouse TV",
    token: "rawtoken",
    tokenHash: "hashvalue",
    createdById: "user_1",
    ...overrides,
  } as never;
}

describe("mapWarehouseToken", () => {
  it("maps epoch-ms dates to Date and strips Convex internals", () => {
    const r = mapWarehouseToken(
      doc({ lastAccessedAt: 1_700_000_300_000, createdAt: 1_700_000_100_000 }),
    );
    expect(r.lastAccessedAt).toBeInstanceOf(Date);
    expect(r.lastAccessedAt?.getTime()).toBe(1_700_000_300_000);
    expect(r.createdAt?.getTime()).toBe(1_700_000_100_000);
    expect(r).not.toHaveProperty("_id");
    expect(r).not.toHaveProperty("_creationTime");
  });

  it("coerces Prisma-defaulted columns when the Convex value is absent", () => {
    const r = mapWarehouseToken(doc());
    // @default(true)
    expect(r.isActive).toBe(true);
    // @default("standard")
    expect(r.layout).toBe("standard");
    // optionals → null
    expect(r.locationId).toBeNull();
    expect(r.lastAccessedAt).toBeNull();
    expect(r.createdAt).toBeNull();
  });

  it("preserves an explicit isActive=false and a set locationId", () => {
    const r = mapWarehouseToken(doc({ isActive: false, locationId: "loc_9", layout: "compact" }));
    expect(r.isActive).toBe(false);
    expect(r.locationId).toBe("loc_9");
    expect(r.layout).toBe("compact");
  });
});
