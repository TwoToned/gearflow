/**
 * src/server/org-join.ts — B2 (#1094): invite-code validation, the per-org
 * join policy, verified-domain discovery/request, and approve/reject. Every
 * mutating path re-checks emailVerified/policy server-side (R-9.3), so these
 * tests focus on the gates rather than re-testing Convex's own logic (that
 * lives in convex/pendingOrgJoinRequests.ts, exercised separately).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://flow.example" } }));

const getOrgContext = vi.fn();
const requirePermission = vi.fn();
vi.mock("@/lib/org-context", () => ({
  getOrgContext: (...a: unknown[]) => getOrgContext(...a),
  requirePermission: (...a: unknown[]) => requirePermission(...a),
}));

const requireSession = vi.fn();
vi.mock("@/lib/auth-server", () => ({
  requireSession: (...a: unknown[]) => requireSession(...a),
}));

const invitationFindUnique = vi.fn();
const organizationFindUnique = vi.fn();
const memberFindMany = vi.fn();
const memberFindFirst = vi.fn();
const memberCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    invitation: { findUnique: (...a: unknown[]) => invitationFindUnique(...a) },
    organization: { findUnique: (...a: unknown[]) => organizationFindUnique(...a) },
    member: {
      findMany: (...a: unknown[]) => memberFindMany(...a),
      findFirst: (...a: unknown[]) => memberFindFirst(...a),
      create: (...a: unknown[]) => memberCreate(...a),
    },
  },
}));

const convexMock = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn(async () => convexMock) }));

const readOrgSettingsBlob = vi.fn();
const saveOrgSettings = vi.fn();
vi.mock("@/lib/org-settings-read", () => ({
  readOrgSettingsBlob: (...a: unknown[]) => readOrgSettingsBlob(...a),
  saveOrgSettings: (...a: unknown[]) => saveOrgSettings(...a),
}));

const sendEmail: (...args: unknown[]) => Promise<void> = vi.fn(async () => undefined);
vi.mock("@/lib/email", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/platform", () => ({ getPlatformName: vi.fn(async () => "RVLT Flow") }));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/member-mirror", () => ({ upsertMemberMirrorByOrgUser: vi.fn(async () => {}) }));

import {
  checkInviteCode,
  getJoinPolicy,
  setJoinPolicy,
  getJoinableOrgs,
  requestToJoinOrg,
  getPendingJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
} from "./org-join";

beforeEach(() => {
  vi.clearAllMocks();
  getOrgContext.mockResolvedValue({ organizationId: "org_A", userId: "user_owner", userName: "Owner" });
  requirePermission.mockResolvedValue({ organizationId: "org_A", userId: "user_owner", userName: "Owner" });
  readOrgSettingsBlob.mockResolvedValue({});
  organizationFindUnique.mockResolvedValue({ name: "Acme" });
});

describe("checkInviteCode", () => {
  it("resolves a bare pending invite id", async () => {
    invitationFindUnique.mockResolvedValue({ status: "pending", expiresAt: new Date(Date.now() + 1000) });
    const result = await checkInviteCode("inv_123");
    expect(result).toEqual({ id: "inv_123" });
  });

  it("extracts the id from a pasted invite URL", async () => {
    invitationFindUnique.mockResolvedValue({ status: "pending", expiresAt: new Date(Date.now() + 1000) });
    const result = await checkInviteCode("https://flow.rvlt.app/invite/inv_abc?foo=bar");
    expect(result).toEqual({ id: "inv_abc" });
    expect(invitationFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "inv_abc" } }));
  });

  it("returns null for an unknown, expired, or non-pending invite", async () => {
    invitationFindUnique.mockResolvedValue(null);
    expect(await checkInviteCode("bogus")).toBeNull();

    invitationFindUnique.mockResolvedValue({ status: "pending", expiresAt: new Date(Date.now() - 1000) });
    expect(await checkInviteCode("expired")).toBeNull();

    invitationFindUnique.mockResolvedValue({ status: "cancelled", expiresAt: new Date(Date.now() + 1000) });
    expect(await checkInviteCode("cancelled")).toBeNull();
  });

  it("returns null for blank input without touching the database", async () => {
    expect(await checkInviteCode("   ")).toBeNull();
    expect(invitationFindUnique).not.toHaveBeenCalled();
  });
});

describe("join policy", () => {
  it("defaults to INVITE_ONLY when unset", async () => {
    readOrgSettingsBlob.mockResolvedValue({});
    expect(await getJoinPolicy()).toBe("INVITE_ONLY");
  });

  it("returns the stored policy", async () => {
    readOrgSettingsBlob.mockResolvedValue({ joinPolicy: "DOMAIN_REQUEST" });
    expect(await getJoinPolicy()).toBe("DOMAIN_REQUEST");
  });

  it("rejects an invalid policy value", async () => {
    // @ts-expect-error deliberate garbage input
    await expect(setJoinPolicy("OPEN")).rejects.toThrow(/invalid/i);
    expect(saveOrgSettings).not.toHaveBeenCalled();
  });

  it("persists a valid policy change", async () => {
    readOrgSettingsBlob.mockResolvedValue({});
    await setJoinPolicy("DOMAIN_REQUEST");
    expect(saveOrgSettings).toHaveBeenCalledWith("org_A", { joinPolicy: "DOMAIN_REQUEST" });
  });
});

describe("getJoinableOrgs", () => {
  it("requires email verification before searching", async () => {
    requireSession.mockResolvedValue({ user: { id: "u1", email: "sam@northlight.com.au", emailVerified: false } });
    const result = await getJoinableOrgs();
    expect(result).toEqual({ requiresVerification: true, orgs: [] });
    expect(convexMock.query).not.toHaveBeenCalled();
  });

  it("searches by domain once verified, marking already-requested orgs", async () => {
    requireSession.mockResolvedValue({ user: { id: "u1", email: "sam@northlight.com.au", emailVerified: true } });
    convexMock.query
      .mockResolvedValueOnce([{ organizationId: "org_x", organizationName: "Northlight AV", memberCount: 3 }])
      .mockResolvedValueOnce([{ organizationId: "org_x" }]);

    const result = await getJoinableOrgs();
    expect(result.requiresVerification).toBe(false);
    expect(result.orgs).toEqual([
      { organizationId: "org_x", organizationName: "Northlight AV", memberCount: 3, alreadyRequested: true },
    ]);
  });
});

describe("requestToJoinOrg", () => {
  it("rejects an unverified email before calling Convex", async () => {
    requireSession.mockResolvedValue({ user: { id: "u1", email: "sam@northlight.com.au", emailVerified: false } });
    await expect(requestToJoinOrg("org_x")).rejects.toThrow(/verify your email/i);
    expect(convexMock.mutation).not.toHaveBeenCalled();
  });

  it("creates the request and emails owners/admins", async () => {
    requireSession.mockResolvedValue({
      user: { id: "u1", email: "sam@northlight.com.au", name: "Sam", emailVerified: true },
    });
    convexMock.mutation.mockResolvedValue({ id: "req_1", created: true });
    memberFindMany.mockResolvedValue([
      { user: { email: "owner@northlight.com.au" } },
      { user: { email: "admin@northlight.com.au" } },
    ]);

    const result = await requestToJoinOrg("org_x");
    expect(result).toEqual({ id: "req_1", created: true });
    expect(convexMock.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: "org_x", userId: "u1", email: "sam@northlight.com.au" }),
    );
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("doesn't re-email admins for an idempotent duplicate request", async () => {
    requireSession.mockResolvedValue({ user: { id: "u1", email: "sam@northlight.com.au", emailVerified: true } });
    convexMock.mutation.mockResolvedValue({ id: "req_1", created: false });

    await requestToJoinOrg("org_x");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("approveJoinRequest / rejectJoinRequest", () => {
  it("approves, creates the member, and emails the requester", async () => {
    convexMock.mutation.mockResolvedValue({ userId: "u_target", email: "target@northlight.com.au" });
    memberFindFirst.mockResolvedValue(null);

    const result = await approveJoinRequest("req_1", "member");
    expect(result).toEqual({ success: true });
    expect(memberCreate).toHaveBeenCalledWith({
      data: { organizationId: "org_A", userId: "u_target", role: "member" },
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("falls back to member role for an unassignable role", async () => {
    convexMock.mutation.mockResolvedValue({ userId: "u_target", email: "target@northlight.com.au" });
    memberFindFirst.mockResolvedValue(null);

    await approveJoinRequest("req_1", "owner");
    expect(memberCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "member" }) }),
    );
  });

  it("rejects and emails the requester without creating a member", async () => {
    convexMock.mutation.mockResolvedValue({ userId: "u_target", email: "target@northlight.com.au" });

    const result = await rejectJoinRequest("req_1", "not a fit");
    expect(result).toEqual({ success: true });
    expect(memberCreate).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("surfaces a clear error when the request no longer exists", async () => {
    convexMock.mutation.mockRejectedValue(new Error("Pending join request not found"));
    await expect(approveJoinRequest("req_gone")).rejects.toThrow(/not found/i);
  });
});

describe("getPendingJoinRequests", () => {
  it("coerces createdAt to a Date", async () => {
    convexMock.query.mockResolvedValue([{ id: "req_1", email: "a@b.com", createdAt: 1700000000000 }]);
    const result = await getPendingJoinRequests();
    expect(result[0].createdAt).toBeInstanceOf(Date);
  });
});
