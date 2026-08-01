import { describe, it, expect, vi, beforeEach } from "vitest";

const memberFindMany = vi.fn();
const organizationFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findMany: (...a: unknown[]) => memberFindMany(...a) },
    organization: { findMany: (...a: unknown[]) => organizationFindMany(...a) },
  },
}));

const getSession = vi.fn();
vi.mock("@/lib/auth-server", () => ({
  getSession: (...a: unknown[]) => getSession(...a),
}));

vi.mock("@/lib/member-mirror", () => ({
  upsertMemberMirrorByOrgUser: vi.fn(),
}));

import { getMyOrganizations, getSoloOrgBranding } from "./public-org";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMyOrganizations — membership-derived, never all orgs (R-9.3)", () => {
  it("returns [] with no session, without querying membership", async () => {
    getSession.mockResolvedValue(null);

    const orgs = await getMyOrganizations();

    expect(orgs).toEqual([]);
    expect(memberFindMany).not.toHaveBeenCalled();
  });

  it("maps the caller's memberships, not a global org list", async () => {
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    memberFindMany.mockResolvedValue([
      { role: "owner", organization: { id: "org_A", name: "Acme", slug: "acme" } },
      { role: "member", organization: { id: "org_B", name: "Beta", slug: "beta" } },
    ]);

    const orgs = await getMyOrganizations();

    expect(memberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_1" } }),
    );
    expect(orgs).toEqual([
      { id: "org_A", name: "Acme", slug: "acme", role: "owner" },
      { id: "org_B", name: "Beta", slug: "beta", role: "member" },
    ]);
  });
});

describe("getSoloOrgBranding — only when exactly one org exists system-wide", () => {
  it("returns the name with exactly one org", async () => {
    organizationFindMany.mockResolvedValue([{ name: "Acme" }]);

    expect(await getSoloOrgBranding()).toEqual({ name: "Acme" });
  });

  it("returns null with zero orgs", async () => {
    organizationFindMany.mockResolvedValue([]);

    expect(await getSoloOrgBranding()).toBeNull();
  });

  it("returns null once a second org exists — no guessing which one to brand", async () => {
    organizationFindMany.mockResolvedValue([{ name: "Acme" }, { name: "Beta" }]);

    expect(await getSoloOrgBranding()).toBeNull();
  });
});
