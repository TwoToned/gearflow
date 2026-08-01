/**
 * src/server/site-admin.ts's getAllOrganizations (#1078, A8) — the real
 * multi-org admin list. Covers the Convex-enrichment merge (last activity,
 * storage, the "never activated" predicate) and the never-activated filter's
 * bounded-window pagination, distinct from site-admin-archive.test.ts's
 * archive/unarchive coverage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const requireSiteAdmin = vi.fn();
vi.mock("@/lib/admin-auth", () => ({
  requireSiteAdmin: (...a: unknown[]) => requireSiteAdmin(...a),
  isSiteAdmin: vi.fn(async () => true),
}));

const organizationFindMany = vi.fn();
const organizationCount = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findMany: (...a: unknown[]) => organizationFindMany(...a),
      count: (...a: unknown[]) => organizationCount(...a),
    },
  },
}));

const convexQuery = vi.fn();
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => ({ query: (...a: unknown[]) => convexQuery(...a) })),
}));

import { getAllOrganizations } from "./site-admin";

const ADMIN_SESSION = { user: { id: "admin_1", name: "Site Admin" } };
const NOW = Date.UTC(2026, 7, 1);
const OLD_DATE = new Date(NOW - 60 * 24 * 60 * 60 * 1000); // 60 days ago
const RECENT_DATE = new Date(NOW - 5 * 24 * 60 * 60 * 1000); // 5 days ago

function org(overrides: Record<string, unknown> = {}) {
  return {
    id: "org_1",
    name: "Acme",
    slug: "acme",
    archivedAt: null,
    createdAt: OLD_DATE,
    members: [],
    _count: { members: 1 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSiteAdmin.mockResolvedValue(ADMIN_SESSION);
  vi.setSystemTime(NOW);
  organizationCount.mockResolvedValue(1);
  // Route by the Convex operation shape: {organizationIds} -> stats batch,
  // {organizationId} -> per-org storage usage.
  convexQuery.mockImplementation((_ref: unknown, args: Record<string, unknown>) => {
    if ("organizationIds" in args) {
      return Promise.resolve(
        (args.organizationIds as string[]).map((organizationId) => ({
          organizationId,
          lastActivityAt: null,
          hasAnyMilestone: false,
        })),
      );
    }
    return Promise.resolve({ fileCount: 0, totalBytes: 0, truncated: false });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getAllOrganizations — Convex enrichment", () => {
  it("merges last activity, storage usage, and archivedAt onto each org", async () => {
    organizationFindMany.mockResolvedValue([org({ archivedAt: new Date(NOW) })]);
    convexQuery.mockImplementation((_ref: unknown, args: Record<string, unknown>) => {
      if ("organizationIds" in args) {
        return Promise.resolve([{ organizationId: "org_1", lastActivityAt: 12345, hasAnyMilestone: true }]);
      }
      return Promise.resolve({ fileCount: 3, totalBytes: 900, truncated: false });
    });

    const result = await getAllOrganizations();

    expect(result.organizations[0]).toMatchObject({
      id: "org_1",
      archivedAt: expect.any(Date),
      lastActivityAt: 12345,
      storageUsage: { fileCount: 3, totalBytes: 900, truncated: false },
    });
  });

  it("makes zero Convex calls when the page is empty", async () => {
    organizationFindMany.mockResolvedValue([]);
    organizationCount.mockResolvedValue(0);

    const result = await getAllOrganizations();

    expect(result.organizations).toEqual([]);
    expect(convexQuery).not.toHaveBeenCalled();
  });
});

describe("getAllOrganizations — never-activated predicate", () => {
  it("flags an org with 1 member, no milestones, no activity, older than 30 days", async () => {
    organizationFindMany.mockResolvedValue([org({ createdAt: OLD_DATE, _count: { members: 1 } })]);

    const result = await getAllOrganizations();

    expect(result.organizations[0].neverActivated).toBe(true);
  });

  it("does not flag an org younger than 30 days", async () => {
    organizationFindMany.mockResolvedValue([org({ createdAt: RECENT_DATE, _count: { members: 1 } })]);

    const result = await getAllOrganizations();

    expect(result.organizations[0].neverActivated).toBe(false);
  });

  it("does not flag an org with more than 1 member", async () => {
    organizationFindMany.mockResolvedValue([org({ createdAt: OLD_DATE, _count: { members: 2 } })]);

    const result = await getAllOrganizations();

    expect(result.organizations[0].neverActivated).toBe(false);
  });

  it("does not flag an org that has any milestone, no matter how old", async () => {
    organizationFindMany.mockResolvedValue([org({ createdAt: OLD_DATE, _count: { members: 1 } })]);
    convexQuery.mockImplementation((_ref: unknown, args: Record<string, unknown>) => {
      if ("organizationIds" in args) {
        return Promise.resolve([{ organizationId: "org_1", lastActivityAt: null, hasAnyMilestone: true }]);
      }
      return Promise.resolve({ fileCount: 0, totalBytes: 0, truncated: false });
    });

    const result = await getAllOrganizations();

    expect(result.organizations[0].neverActivated).toBe(false);
  });

  it("does not flag an org with any activity log entry", async () => {
    organizationFindMany.mockResolvedValue([org({ createdAt: OLD_DATE, _count: { members: 1 } })]);
    convexQuery.mockImplementation((_ref: unknown, args: Record<string, unknown>) => {
      if ("organizationIds" in args) {
        return Promise.resolve([{ organizationId: "org_1", lastActivityAt: 999, hasAnyMilestone: false }]);
      }
      return Promise.resolve({ fileCount: 0, totalBytes: 0, truncated: false });
    });

    const result = await getAllOrganizations();

    expect(result.organizations[0].neverActivated).toBe(false);
  });
});

describe("getAllOrganizations — neverActivatedOnly filter", () => {
  it("returns only never-activated orgs and recomputes total against the filtered set", async () => {
    organizationFindMany.mockResolvedValue([
      org({ id: "org_dormant", createdAt: OLD_DATE, _count: { members: 1 } }),
      org({ id: "org_live", createdAt: RECENT_DATE, _count: { members: 1 } }),
    ]);
    organizationCount.mockResolvedValue(2);

    const result = await getAllOrganizations({ neverActivatedOnly: true });

    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0].id).toBe("org_dormant");
    expect(result.total).toBe(1);
  });
});
