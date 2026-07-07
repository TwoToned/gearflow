import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActorContext } from "./actor-context";

// Mock prisma so the unit test needs no DB. Only member/customRole are touched
// by the permission resolver.
const memberFindFirst = vi.fn();
const customRoleFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findFirst: (...a: unknown[]) => memberFindFirst(...a) },
    customRole: { findUnique: (...a: unknown[]) => customRoleFindUnique(...a) },
  },
}));

// Mock auth-server so importing org-context doesn't pull in next/headers + the
// Better Auth config. requireOrganization is the session path; we assert it is
// NOT called when an explicit actor is supplied.
const requireOrganization = vi.fn();
vi.mock("@/lib/auth-server", () => ({
  requireOrganization: (...a: unknown[]) => requireOrganization(...a),
}));

import { resolvePermissionForActor, requirePermission } from "@/lib/org-context";

const OWNER_SESSION: ActorContext = {
  organizationId: "org_1",
  userId: "user_1",
  userName: "Ada",
  actorType: "session",
};

const OWNER_APIKEY: ActorContext = {
  organizationId: "org_1",
  userId: "user_1",
  userName: "Ada",
  actorType: "apiKey",
  apiKeyId: "key_1",
  scopes: ["project:manage_line_items"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvePermissionForActor — one RBAC path for session and API key", () => {
  it("grants an allowed action identically for a session and an API-key actor", async () => {
    memberFindFirst.mockResolvedValue({ role: "owner" });

    const sessionResult = await resolvePermissionForActor(
      OWNER_SESSION,
      "project",
      "manage_line_items",
    );
    const apiKeyResult = await resolvePermissionForActor(
      OWNER_APIKEY,
      "project",
      "manage_line_items",
    );

    // Same org+user → byte-for-byte the same authorization outcome, regardless
    // of how the caller authenticated. This is the whole point of the seam.
    expect(sessionResult).toEqual({
      organizationId: "org_1",
      userId: "user_1",
      userName: "Ada",
    });
    expect(apiKeyResult).toEqual(sessionResult);
  });

  it("denies an action the acting user's role lacks (API key can't exceed the user's RBAC)", async () => {
    memberFindFirst.mockResolvedValue({ role: "viewer" });

    await expect(
      resolvePermissionForActor(OWNER_APIKEY, "project", "create"),
    ).rejects.toThrow(/don't have permission/i);
  });

  it("rejects an actor who is not a member of the org", async () => {
    memberFindFirst.mockResolvedValue(null);

    await expect(
      resolvePermissionForActor(OWNER_APIKEY, "project", "read"),
    ).rejects.toThrow(/not a member/i);
  });
});

describe("requirePermission — explicit actor bypasses the session entirely", () => {
  it("uses the passed actor and never touches the Better Auth session", async () => {
    memberFindFirst.mockResolvedValue({ role: "owner" });

    const result = await requirePermission(
      "project",
      "manage_line_items",
      OWNER_APIKEY,
    );

    expect(result).toEqual({
      organizationId: "org_1",
      userId: "user_1",
      userName: "Ada",
    });
    // The API path must not read the request/session.
    expect(requireOrganization).not.toHaveBeenCalled();
  });

  it("falls back to the session actor when none is passed (unchanged UI behaviour)", async () => {
    requireOrganization.mockResolvedValue({
      organizationId: "org_1",
      session: { user: { id: "user_1", name: "Ada" }, session: {} },
    });
    memberFindFirst.mockResolvedValue({ role: "owner" });

    const result = await requirePermission("project", "read");

    expect(result.userId).toBe("user_1");
    expect(requireOrganization).toHaveBeenCalledOnce();
  });
});
