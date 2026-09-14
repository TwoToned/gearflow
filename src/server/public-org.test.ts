import { describe, it, expect, vi, beforeEach } from "vitest";

const memberFindMany = vi.fn();
const memberFindFirst = vi.fn();
const organizationFindMany = vi.fn();
const organizationFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: {
      findMany: (...a: unknown[]) => memberFindMany(...a),
      findFirst: (...a: unknown[]) => memberFindFirst(...a),
    },
    organization: {
      findMany: (...a: unknown[]) => organizationFindMany(...a),
      findUnique: (...a: unknown[]) => organizationFindUnique(...a),
    },
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

const invalidateOrgLoginInfoCache = vi.fn();
vi.mock("@/lib/org-login-info-cache", () => ({
  invalidateOrgLoginInfoCache: (...a: unknown[]) => invalidateOrgLoginInfoCache(...a),
}));

import {
  checkSlugAvailable,
  getMyOrganizations,
  getSoloOrgBranding,
  hasOnlyArchivedMemberships,
  seedOrgDefaults,
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

describe("seedOrgDefaults — seed tax rate + currency at creation, never a live read (#1077, A7; C1, #1098)", () => {
  it("copies the platform's CURRENT defaultTaxRate + defaultCurrency into the new org's own settings", async () => {
    getSiteSettingsFromConvex.mockResolvedValue({ defaultCurrency: "GBP", defaultTaxRate: 15 });

    await seedOrgDefaults("org_new", "acme");

    expect(saveOrgSettings).toHaveBeenCalledWith("org_new", { currency: "GBP" }, 15);
  });

  it("busts the org-login-info cache for the new org's slug", async () => {
    getSiteSettingsFromConvex.mockResolvedValue({ defaultCurrency: "AUD", defaultTaxRate: 10 });

    await seedOrgDefaults("org_new", "acme");

    expect(invalidateOrgLoginInfoCache).toHaveBeenCalledWith("acme");
  });
});

describe("checkSlugAvailable — UX-only tick, not a new authorization surface (C1, #1098)", () => {
  it("returns false with no session", async () => {
    getSession.mockResolvedValue(null);

    expect(await checkSlugAvailable("acme")).toBe(false);
    expect(organizationFindUnique).not.toHaveBeenCalled();
  });

  it("returns false for an empty/whitespace slug without querying", async () => {
    getSession.mockResolvedValue({ user: { id: "user_1" } });

    expect(await checkSlugAvailable("   ")).toBe(false);
    expect(organizationFindUnique).not.toHaveBeenCalled();
  });

  it("returns false for an oversized slug without querying (no real slug is this long)", async () => {
    getSession.mockResolvedValue({ user: { id: "user_1" } });

    expect(await checkSlugAvailable("a".repeat(101))).toBe(false);
    expect(organizationFindUnique).not.toHaveBeenCalled();
  });

  it("returns true when no org has claimed the (normalized) slug", async () => {
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    organizationFindUnique.mockResolvedValue(null);

    expect(await checkSlugAvailable("Acme")).toBe(true);
    expect(organizationFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "acme" } }),
    );
  });

  it("returns false when the slug is already taken", async () => {
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    organizationFindUnique.mockResolvedValue({ id: "org_existing" });

    expect(await checkSlugAvailable("acme")).toBe(false);
  });
});
