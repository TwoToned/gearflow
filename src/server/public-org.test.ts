import { describe, it, expect, vi, beforeEach } from "vitest";

const memberFindMany = vi.fn();
const memberFindFirst = vi.fn();
const organizationFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: {
      findMany: (...a: unknown[]) => memberFindMany(...a),
      findFirst: (...a: unknown[]) => memberFindFirst(...a),
    },
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

const saveOrgSettings = vi.fn();
vi.mock("@/lib/org-settings-read", () => ({
  saveOrgSettings: (...a: unknown[]) => saveOrgSettings(...a),
}));

const getSiteSettingsFromConvex = vi.fn();
vi.mock("@/lib/site-settings-read", () => ({
  getSiteSettingsFromConvex: (...a: unknown[]) => getSiteSettingsFromConvex(...a),
}));

import {
  getMyOrganizations,
  getSoloOrgBranding,
  hasOnlyArchivedMemberships,
  seedOrgDefaultTaxRate,
} from "./public-org";

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
      expect.objectContaining({
        where: { userId: "user_1", organization: { archivedAt: null } },
      }),
    );
    expect(orgs).toEqual([
      { id: "org_A", name: "Acme", slug: "acme", role: "owner" },
      { id: "org_B", name: "Beta", slug: "beta", role: "member" },
    ]);
  });
});

describe("hasOnlyArchivedMemberships — distinguishes archived-only from never-had-one (#1075, A5)", () => {
  it("returns false with no session", async () => {
    getSession.mockResolvedValue(null);

    expect(await hasOnlyArchivedMemberships()).toBe(false);
  });

  it("returns false when the caller has no memberships at all", async () => {
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    memberFindFirst.mockResolvedValue(null);

    expect(await hasOnlyArchivedMemberships()).toBe(false);
  });

  it("returns false when at least one membership is live", async () => {
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    memberFindFirst.mockResolvedValueOnce({ id: "m1" }).mockResolvedValueOnce({ id: "m1" });

    expect(await hasOnlyArchivedMemberships()).toBe(false);
  });

  it("returns true when every membership is archived", async () => {
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    // First call (any membership, no archivedAt filter) finds one; second
    // call (archivedAt: null filter) finds none.
    memberFindFirst.mockResolvedValueOnce({ id: "m1" }).mockResolvedValueOnce(null);

    expect(await hasOnlyArchivedMemberships()).toBe(true);
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

describe("seedOrgDefaultTaxRate — seed at creation, never a live read (#1077, A7)", () => {
  it("copies the platform's CURRENT defaultTaxRate into the new org's own settings", async () => {
    getSiteSettingsFromConvex.mockResolvedValue({ defaultCurrency: "AUD", defaultTaxRate: 15 });

    await seedOrgDefaultTaxRate("org_new");

    expect(saveOrgSettings).toHaveBeenCalledWith("org_new", {}, 15);
  });
});
