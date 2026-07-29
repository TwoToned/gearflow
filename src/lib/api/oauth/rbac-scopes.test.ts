import { describe, test, expect } from "vitest";
import { scopesForRole, narrowScopesToRole, describeScope } from "./rbac-scopes";

describe("scopesForRole", () => {
  test("owner gets the full concrete scope list, no wildcards", () => {
    const scopes = scopesForRole("owner");
    expect(scopes).toContain("asset:delete");
    expect(scopes).toContain("orgSettings:update");
    expect(scopes).toContain("self:read");
    expect(scopes).toContain("self:write");
    expect(scopes.some((s) => s.endsWith(":*") || s === "*")).toBe(false);
  });

  test("a lesser role's scopes are a strict subset of owner's", () => {
    const member = new Set(scopesForRole("member"));
    const owner = new Set(scopesForRole("owner"));
    for (const s of member) expect(owner.has(s)).toBe(true);
    expect(member.size).toBeLessThan(owner.size);
  });

  test("member never gets orgSettings:update or warehouse:close (owner-only actions)", () => {
    const member = scopesForRole("member");
    expect(member).not.toContain("orgSettings:update");
    expect(member).not.toContain("warehouse:close");
  });

  test("null/unknown role -> no scopes (fail closed)", () => {
    expect(scopesForRole(null)).toEqual([]);
    expect(scopesForRole("not-a-real-role")).toEqual([]);
  });
});

describe("narrowScopesToRole — the OAuth consent narrowing rule", () => {
  test("a requested scope the role doesn't have is silently dropped, not granted", () => {
    const narrowed = narrowScopesToRole(["orgSettings:update", "asset:read"], "member");
    expect(narrowed).toContain("asset:read");
    expect(narrowed).not.toContain("orgSettings:update");
  });

  test("a wildcard '*' request narrows to the role's own ceiling, never the literal '*'", () => {
    const narrowed = narrowScopesToRole(["*"], "member");
    expect(narrowed).not.toContain("*");
    expect(narrowed).toEqual(scopesForRole("member").sort());
  });

  test("a 'resource:*' request expands to only the concrete actions the role holds on that resource", () => {
    const narrowed = narrowScopesToRole(["invoice:*"], "member");
    // member's invoice actions are create/read only (see permissionsCore.rolePermissions.member)
    expect(narrowed).toEqual(["invoice:create", "invoice:read"]);
  });

  test("an owner requesting the same scopes gets them all — narrowing depends on the consenting user's role", () => {
    const memberNarrowed = narrowScopesToRole(["invoice:*"], "member");
    const ownerNarrowed = narrowScopesToRole(["invoice:*"], "owner");
    expect(ownerNarrowed.length).toBeGreaterThan(memberNarrowed.length);
  });

  test("a demoted/unknown role narrows every request to nothing", () => {
    expect(narrowScopesToRole(["asset:read", "project:read"], null)).toEqual([]);
  });
});

describe("describeScope — plain-language consent-screen labels", () => {
  test("renders a recognised resource:action pair in plain English", () => {
    expect(describeScope("asset:read")).toBe("View assets");
    expect(describeScope("project:manage_line_items")).toBe("Manage line items on projects");
  });

  test("falls back gracefully for a malformed scope string", () => {
    expect(describeScope("not-a-scope")).toBe("not-a-scope");
  });
});
