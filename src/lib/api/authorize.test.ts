import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActorContext } from "../actor-context";

// DB-free: mock prisma (member lookup drives RBAC) and auth-server (session path,
// which must never be reached for an explicit API-key actor).
const memberFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findFirst: (...a: unknown[]) => memberFindFirst(...a) },
  },
}));
const requireOrganization = vi.fn();
vi.mock("@/lib/auth-server", () => ({
  requireOrganization: (...a: unknown[]) => requireOrganization(...a),
}));

import { authorizeApiOperation } from "@/lib/api/authorize";
import { ApiKeyAuthError } from "@/lib/api-key";

function apiActor(scopes: string[]): ActorContext {
  return {
    organizationId: "org_1",
    userId: "user_1",
    userName: "Ada",
    actorType: "apiKey",
    apiKeyId: "key_1",
    scopes,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("authorizeApiOperation — scope ∩ RBAC intersection", () => {
  it("allows only when the key HAS the scope AND the user's role allows it", async () => {
    memberFindFirst.mockResolvedValue({ role: "owner" }); // RBAC: allowed

    const result = await authorizeApiOperation(
      apiActor(["project:manage_line_items"]),
      "project",
      "manage_line_items",
    );

    expect(result).toEqual({ organizationId: "org_1", userId: "user_1", userName: "Ada" });
  });

  it("denies (MISSING_SCOPE) when the key lacks the scope — and never spends a DB query on RBAC", async () => {
    await expect(
      authorizeApiOperation(apiActor(["assets:read"]), "project", "manage_line_items"),
    ).rejects.toBeInstanceOf(ApiKeyAuthError);

    // Scope failed first → the role lookup was never reached.
    expect(memberFindFirst).not.toHaveBeenCalled();
  });

  it("denies when the key has the scope but the acting user's role does not (RBAC caps the key)", async () => {
    memberFindFirst.mockResolvedValue({ role: "viewer" }); // read-only role

    await expect(
      // Key is broadly scoped, but a viewer cannot manage line items.
      authorizeApiOperation(apiActor(["project:*"]), "project", "manage_line_items"),
    ).rejects.toThrow(/don't have permission/i);
  });

  it("for a session actor, scope is a no-op and it collapses to plain requirePermission", async () => {
    memberFindFirst.mockResolvedValue({ role: "owner" });
    const sessionActor: ActorContext = {
      organizationId: "org_1",
      userId: "user_1",
      userName: "Ada",
      actorType: "session",
    };

    const result = await authorizeApiOperation(sessionActor, "project", "read");

    expect(result.organizationId).toBe("org_1");
    // Explicit actor path — the request/session is never read.
    expect(requireOrganization).not.toHaveBeenCalled();
  });
});
