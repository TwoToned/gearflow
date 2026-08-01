/**
 * src/server/settings.ts's addMemberByEmail — the #1073 (A3) security fix:
 * membership requires the recipient to accept. Before this fix, a known
 * user's account was added directly to the org with no invitation and no
 * consent, which under multi-tenancy meant any owner could pull a stranger's
 * account into their org just by knowing their email.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getOrgContext = vi.fn();
vi.mock("@/lib/org-context", () => ({
  getOrgContext: (...a: unknown[]) => getOrgContext(...a),
}));

const invitationFindFirst = vi.fn();
const invitationCreate = vi.fn();
const userFindFirst = vi.fn();
const memberFindFirst = vi.fn();
const organizationFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    invitation: {
      findFirst: (...a: unknown[]) => invitationFindFirst(...a),
      create: (...a: unknown[]) => invitationCreate(...a),
    },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    member: { findFirst: (...a: unknown[]) => memberFindFirst(...a) },
    organization: { findUnique: (...a: unknown[]) => organizationFindUnique(...a) },
  },
}));

const sendEmail = vi.fn();
vi.mock("@/lib/email", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/platform", () => ({ getPlatformName: vi.fn(async () => "RVLT Flow") }));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/member-mirror", () => ({
  upsertMemberMirror: vi.fn(),
  removeMemberMirror: vi.fn(),
}));

import { addMemberByEmail } from "./settings";

const ACTOR = { organizationId: "org_A", userId: "user_owner", userName: "Owner" };

beforeEach(() => {
  vi.clearAllMocks();
  getOrgContext.mockResolvedValue(ACTOR);
  invitationFindFirst.mockResolvedValue(null);
  organizationFindUnique.mockResolvedValue({ name: "Acme" });
  invitationCreate.mockResolvedValue({ id: "inv_1" });
});

describe("addMemberByEmail — invite-only, never a direct add", () => {
  it("creates an invitation instead of a Member row for a known user's account", async () => {
    userFindFirst.mockResolvedValue({ id: "user_target" });
    memberFindFirst.mockResolvedValue(null); // not already a member

    const result = await addMemberByEmail("target@example.com", "member");

    expect(invitationCreate).toHaveBeenCalledTimes(1);
    expect(invitationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org_A",
          email: "target@example.com",
          role: "member",
          status: "pending",
        }),
      }),
    );
    expect(result).toEqual({ id: "inv_1", invited: true, email: "target@example.com" });

    // The victim gets an accept-URL email, not a silent membership grant.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailArg = sendEmail.mock.calls[0][0];
    expect(emailArg.to).toBe("target@example.com");
    expect(emailArg.html).toContain("/invite/inv_1");
  });

  it("creates an invitation for an email with no existing account too", async () => {
    userFindFirst.mockResolvedValue(null);

    await addMemberByEmail("stranger@example.com", "member");

    expect(invitationCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects a known user who is already a member", async () => {
    userFindFirst.mockResolvedValue({ id: "user_target" });
    memberFindFirst.mockResolvedValue({ id: "member_1" });

    await expect(addMemberByEmail("target@example.com", "member")).rejects.toThrow(
      /already a member/i,
    );
    expect(invitationCreate).not.toHaveBeenCalled();
  });

  it("rejects a duplicate pending invitation", async () => {
    invitationFindFirst.mockResolvedValue({ id: "existing_invite" });

    await expect(addMemberByEmail("target@example.com", "member")).rejects.toThrow(
      /invitation has already been sent/i,
    );
    expect(invitationCreate).not.toHaveBeenCalled();
  });

  it("rejects an invalid role before touching the database", async () => {
    await expect(addMemberByEmail("target@example.com", "owner")).rejects.toThrow(/invalid role/i);
    expect(invitationFindFirst).not.toHaveBeenCalled();
  });
});
