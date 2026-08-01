import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma so the unit test needs no DB — only member.findFirst is touched.
const memberFindFirst = vi.fn();
vi.mock("./prisma", () => ({
  prisma: {
    member: { findFirst: (...a: unknown[]) => memberFindFirst(...a) },
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
      where: { organizationId: "org_A", userId: "user_1" },
      select: { id: true },
    });
  });

  it("never trusts activeOrganizationId alone (R-9.3) — no live Member row resolves to null", async () => {
    // e.g. the session claims an org the caller was removed from, or an
    // archived/forged value — activeOrganizationId being set is not enough.
    getSession.mockResolvedValue(sessionWithActiveOrg("org_B"));
    memberFindFirst.mockResolvedValue(null);

    const orgId = await getActiveOrganizationId();

    expect(orgId).toBeNull();
  });

  it("returns null with no session", async () => {
    getSession.mockResolvedValue(null);

    const orgId = await getActiveOrganizationId();

    expect(orgId).toBeNull();
    expect(memberFindFirst).not.toHaveBeenCalled();
  });

  it("returns null when the session has no active org set", async () => {
    getSession.mockResolvedValue(sessionWithActiveOrg(null));

    const orgId = await getActiveOrganizationId();

    expect(orgId).toBeNull();
    expect(memberFindFirst).not.toHaveBeenCalled();
  });
});

describe("requireOrganization — throws rather than guessing", () => {
  it("throws when the caller has no valid active org", async () => {
    getSession.mockResolvedValue(sessionWithActiveOrg("org_A"));
    memberFindFirst.mockResolvedValue(null);

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
