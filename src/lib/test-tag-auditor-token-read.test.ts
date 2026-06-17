import { describe, it, expect } from "vitest";
import { mapAuditorToken } from "./test-tag-auditor-token-read";

function doc(overrides: Record<string, unknown> = {}) {
  return {
    _id: "convex_internal_id" as never,
    _creationTime: 1_700_000_000_000,
    id: "tok_1",
    organizationId: "org_1",
    name: "Insurance Auditor",
    token: "rawtoken",
    tokenHash: "hashvalue",
    createdById: "user_1",
    ...overrides,
  } as never;
}

describe("mapAuditorToken", () => {
  it("maps epoch-ms dates to Date and strips Convex internals", () => {
    const r = mapAuditorToken(
      doc({
        expiresAt: 1_700_000_900_000,
        lastAccessedAt: 1_700_000_300_000,
        createdAt: 1_700_000_100_000,
      }),
    );
    expect(r.expiresAt?.getTime()).toBe(1_700_000_900_000);
    expect(r.lastAccessedAt?.getTime()).toBe(1_700_000_300_000);
    expect(r.createdAt?.getTime()).toBe(1_700_000_100_000);
    expect(r).not.toHaveProperty("_id");
    expect(r).not.toHaveProperty("_creationTime");
  });

  it("coerces defaults / absent optionals", () => {
    const r = mapAuditorToken(doc());
    expect(r.isActive).toBe(true); // @default(true)
    expect(r.expiresAt).toBeNull();
    expect(r.scope).toBeNull();
    expect(r.lastAccessedAt).toBeNull();
    expect(r.createdAt).toBeNull();
  });

  it("preserves an explicit isActive=false and a scope JSON string", () => {
    const r = mapAuditorToken(doc({ isActive: false, scope: '{"locations":["A"]}' }));
    expect(r.isActive).toBe(false);
    expect(r.scope).toBe('{"locations":["A"]}');
  });
});
