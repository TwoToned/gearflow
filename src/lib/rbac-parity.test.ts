import { describe, it, expect } from "vitest";
import {
  decideOrgPermission,
  hasPermission,
  type PermissionMap,
} from "../../convex/lib/permissionsCore";
// Re-export sanity: the server path imports the SAME core via @/lib/permissions.
import { hasPermission as hasPermissionReExport } from "@/lib/permissions";

/**
 * RBAC parity gate (docs/designs/convex-native-read-layer.md §3.3.3, §8).
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
        { auth: null, requestedOrgId: ORG, member: null, customPermissions: null },
        "project",
        "read",
      ),
    ).toBe("deny:unauthenticated");
  });

  it("allows the trusted service identity unconditionally", () => {
    expect(
      decideOrgPermission(
        { auth: { kind: "service" }, requestedOrgId: ORG, member: null, customPermissions: null },
        "asset",
        "delete",
      ),
    ).toBe("allow");
  });

  it("denies on org mismatch (token org ≠ requested org)", () => {
    expect(
      decideOrgPermission(
        { auth: user("org_other"), requestedOrgId: ORG, member: { role: "owner" }, customPermissions: null },
        "project",
        "read",
      ),
    ).toBe("deny:org-mismatch");
  });

  it("denies when the token carries no org", () => {
    expect(
      decideOrgPermission(
        { auth: user(null), requestedOrgId: ORG, member: { role: "owner" }, customPermissions: null },
        "project",
        "read",
      ),
    ).toBe("deny:org-mismatch");
  });

  it("denies a non-member even with a matching org", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: null, customPermissions: null },
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
        { auth: user(), requestedOrgId: ORG, member: { role: "owner" }, customPermissions: null },
        "orgSettings",
        "update",
      ),
    ).toBe("allow");
  });

  it("viewer HAS project:read (the review-corrected case)", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "viewer" }, customPermissions: null },
        "project",
        "read",
      ),
    ).toBe("allow");
  });

  it("viewer is DENIED asset:create (genuinely-denied pair)", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "viewer" }, customPermissions: null },
        "asset",
        "create",
      ),
    ).toBe("deny:insufficient");
  });

  it("member is denied orgSettings:update", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "member" }, customPermissions: null },
        "orgSettings",
        "update",
      ),
    ).toBe("deny:insufficient");
  });

  it("manager is allowed warehouse:close", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "manager" }, customPermissions: null },
        "warehouse",
        "close",
      ),
    ).toBe("allow");
  });

  it("unknown built-in role is denied", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "nonsense" }, customPermissions: null },
        "project",
        "read",
      ),
    ).toBe("deny:insufficient");
  });
});

describe("decideOrgPermission — custom roles", () => {
  const customPerms: PermissionMap = { asset: ["read"], project: ["read", "update"] };

  it("grants exactly the custom role's permissions", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "custom:r1" }, customPermissions: customPerms },
        "asset",
        "read",
      ),
    ).toBe("allow");
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "custom:r1" }, customPermissions: customPerms },
        "project",
        "update",
      ),
    ).toBe("allow");
  });

  it("denies actions the custom role lacks", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "custom:r1" }, customPermissions: customPerms },
        "asset",
        "delete",
      ),
    ).toBe("deny:insufficient");
  });

  it("denies a custom role with no resolved permissions (missing/cross-org role)", () => {
    expect(
      decideOrgPermission(
        { auth: user(), requestedOrgId: ORG, member: { role: "custom:gone" }, customPermissions: null },
        "asset",
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
