import { describe, it, expect } from "vitest";
import {
  decideOrgPermission,
  hasPermission,
} from "../../convex/lib/permissionsCore";
// Re-export sanity: the server path imports the SAME core via @/lib/permissions.
import { hasPermission as hasPermissionReExport } from "@/lib/permissions";

/**
 * RBAC parity gate.
 *
 * The Convex `requireOrgPermission` guard delegates its decision to
 * `decideOrgPermission` → `hasPermission`, the SAME isomorphic functions the
 * server-action `requirePermission` uses. So asserting these here asserts that a
 * native browser read grants exactly what a server action would. Includes the
 * cases the design review flagged (viewer HAS project:read; a genuinely-denied
 * pair for the deny assertion).
 */

const ORG = "org_1";
const user = (orgId: string | null = ORG) =>
  ({ kind: "user" as const, userId: "u_1", orgId });

describe("decideOrgPermission — auth/org gating", () => {
  it("denies an anonymous caller", () => {
    expect(
      decideOrgPermission(
        { auth: null, requestedOrgId: ORG, member: null },
        "project",
        "read",
      ),
    ).toBe("deny:unauthenticated");
  });

  it("allows the trusted service identity unconditionally", () => {
    expect(
      decideOrgPermission(
        { auth: { kind: "service" }, requestedOrgId: ORG, member: null },
        "asset",
        "delete",
      ),
    ).toBe("allow");
  });

  it("denies on org mismatch (token org ≠ requested org)", () => {
    expect(
      decideOrgPermission(
        { auth: user("org_other"), requestedOrgId: ORG, member: { role: "owner" } },
        "project",
        "read",
      ),
    ).toBe("deny:org-mismatch");
  });

  it("denies when the token carries no org", () => {
    expect(
      decideOrgPermission(
        { auth: user(null), requestedOrgId: ORG, member: { role: "owner" } },
        "project",
        "read",
      ),
    ).toBe("deny:org-mismatch");
  });

  it("denies a non-member even with a matching org", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: null },
        "project",
        "read",
      ),
    ).toBe("deny:not-member");
  });
});

describe("decideOrgPermission — role permissions (parity with server actions)", () => {
  it("owner is allowed anything (safety net)", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "owner" } },
        "orgSettings",
        "update",
      ),
    ).toBe("allow");
  });

  it("viewer HAS project:read (the review-corrected case)", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "viewer" } },
        "project",
        "read",
      ),
    ).toBe("allow");
  });

  it("viewer is DENIED asset:create (genuinely-denied pair)", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "viewer" } },
        "asset",
        "create",
      ),
    ).toBe("deny:insufficient");
  });

  it("member is denied orgSettings:update", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "member" } },
        "orgSettings",
        "update",
      ),
    ).toBe("deny:insufficient");
  });

  it("manager is allowed warehouse:close", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "manager" } },
        "warehouse",
        "close",
      ),
    ).toBe("allow");
  });

  it("unknown built-in role is denied", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "nonsense" } },
        "project",
        "read",
      ),
    ).toBe("deny:insufficient");
  });
});

describe("hasPermission core + re-export parity", () => {
  it("owner allow-all, viewer read-only", () => {
    expect(hasPermission("owner", "asset", "delete")).toBe(true);
    expect(hasPermission("viewer", "project", "read")).toBe(true);
    expect(hasPermission("viewer", "asset", "create")).toBe(false);
  });

  it("@/lib/permissions re-exports the identical hasPermission", () => {
    expect(hasPermissionReExport).toBe(hasPermission);
  });
});
