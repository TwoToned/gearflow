import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma so the unit test needs no DB — only member.findFirst/findMany are touched.
const memberFindFirst = vi.fn();
const memberFindMany = vi.fn();
vi.mock("./prisma", () => ({
  prisma: {
    member: {
      findFirst: (...a: unknown[]) => memberFindFirst(...a),
      findMany: (...a: unknown[]) => memberFindMany(...a),
    },
  },
}));

// Mock next/headers — getSession() awaits it before calling auth.api.getSession.
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock the Better Auth instance so importing auth-server doesn't pull in the
// full Better Auth config (DB adapter, plugins, env). Only auth.api.getSession
// is touched by auth-server.ts.
const getSession = vi.fn();
vi.mock("./auth", () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } },
}));

import { getActiveOrganizationId, requireOrganization } from "./auth-server";

const sessionWithActiveOrg = (activeOrganizationId: string | null | undefined) => ({
  session: { id: "sess_1", userId: "user_1", activeOrganizationId },
  user: { id: "user_1", name: "Ada", email: "ada@example.com" },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getActiveOrganizationId — re-validates the session's active org (#1071, A1)", () => {
  it("returns the active org when the user has a live Member row for it", async () => {
    getSession.mockResolvedValue(sessionWithActiveOrg("org_A"));
    memberFindFirst.mockResolvedValue({ id: "member_1" });

    const orgId = await getActiveOrganizationId();

    expect(orgId).toBe("org_A");
    expect(memberFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org_A",
        userId: "user_1",
        organization: { archivedAt: null },
      },
      select: { id: true },
    });
  });

  it("never trusts activeOrganizationId alone (R-9.3) — an invalid claim with 0 or 2+ other memberships resolves to null", async () => {
    // e.g. the session claims an org the caller was removed from, an archived
    // org (#1075, A5 — the archivedAt: null filter is what makes the query
    // itself return null for one), or a forged value — activeOrganizationId
    // being set is not enough. With no other single membership to fall back
    // to, this must not guess.
    getSession.mockResolvedValue(sessionWithActiveOrg("org_B"));
    memberFindFirst.mockResolvedValue(null);
    memberFindMany.mockResolvedValue([]);

    const orgId = await getActiveOrganizationId();

    expect(orgId).toBeNull();
  });

  it("returns null with no session", async () => {
    getSession.mockResolvedValue(null);

    const orgId = await getActiveOrganizationId();

    expect(orgId).toBeNull();
    expect(memberFindFirst).not.toHaveBeenCalled();
    expect(memberFindMany).not.toHaveBeenCalled();
  });

  it("returns null when no active org is set and the user has 0 or 2+ memberships — never guesses", async () => {
    getSession.mockResolvedValue(sessionWithActiveOrg(null));
    memberFindMany.mockResolvedValue([
      { organizationId: "org_A" },
      { organizationId: "org_B" },
    ]);

    const orgId = await getActiveOrganizationId();

    expect(orgId).toBeNull();
    expect(memberFindFirst).not.toHaveBeenCalled();
  });

  it("falls back to the user's sole membership when no active org is set (SSO-redirect race)", async () => {
    // Mirrors definePayload's (src/lib/auth.ts) Convex JWT fallback: an SSO
    // login redirects straight past handlePostLogin's organization.setActive(),
    // so the FIRST server-rendered request after login may see no active org
    // yet. With exactly one live membership there's nothing to guess.
    getSession.mockResolvedValue(sessionWithActiveOrg(null));
    memberFindMany.mockResolvedValue([{ organizationId: "org_solo" }]);

    const orgId = await getActiveOrganizationId();

    expect(orgId).toBe("org_solo");
    expect(memberFindFirst).not.toHaveBeenCalled();
    expect(memberFindMany).toHaveBeenCalledWith({
      where: { userId: "user_1", organization: { archivedAt: null } },
      select: { organizationId: true },
      take: 2,
    });
  });

  it("falls back to the sole membership when the claimed active org no longer resolves", async () => {
    getSession.mockResolvedValue(sessionWithActiveOrg("org_stale"));
    memberFindFirst.mockResolvedValue(null);
    memberFindMany.mockResolvedValue([{ organizationId: "org_solo" }]);

    const orgId = await getActiveOrganizationId();

    expect(orgId).toBe("org_solo");
  });
});

describe("requireOrganization — throws rather than guessing", () => {
  it("throws when the caller has no valid active org and no fallback membership", async () => {
    getSession.mockResolvedValue(sessionWithActiveOrg("org_A"));
    memberFindFirst.mockResolvedValue(null);
    memberFindMany.mockResolvedValue([]);

    await expect(requireOrganization()).rejects.toThrow(/No active organization/);
  });

  it("returns { session, organizationId } once re-validated", async () => {
    const session = sessionWithActiveOrg("org_A");
    getSession.mockResolvedValue(session);
    memberFindFirst.mockResolvedValue({ id: "member_1" });

    const result = await requireOrganization();

    expect(result).toEqual({ session, organizationId: "org_A" });
  });
});
