/**
 * src/server/site-admin.ts's adminArchiveOrganization / adminUnarchiveOrganization
 * (#1075, A5). These replace the old adminDeleteOrganization, a bare
 * `prisma.organization.delete()` that orphaned every Convex-side domain
 * record (assets/projects/quotes/...) since Postgres FK cascades don't reach
 * Convex. Archiving is the reversible fix (D12).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireSiteAdmin = vi.fn();
vi.mock("@/lib/admin-auth", () => ({
  requireSiteAdmin: (...a: unknown[]) => requireSiteAdmin(...a),
  isSiteAdmin: vi.fn(async () => true),
}));

const organizationFindUnique = vi.fn();
const organizationUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: (...a: unknown[]) => organizationFindUnique(...a),
      update: (...a: unknown[]) => organizationUpdate(...a),
    },
  },
}));

vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/platform", () => ({ invalidatePlatformNameCache: vi.fn() }));

import { adminArchiveOrganization, adminUnarchiveOrganization } from "./site-admin";

const ADMIN_SESSION = { user: { id: "admin_1", name: "Site Admin" } };

beforeEach(() => {
  vi.clearAllMocks();
  requireSiteAdmin.mockResolvedValue(ADMIN_SESSION);
});

describe("adminArchiveOrganization", () => {
  it("sets archivedAt and releases the slug so a new org can claim it", async () => {
    organizationFindUnique.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      archivedAt: null,
    });
    organizationUpdate.mockImplementation(({ data }) => ({ id: "org_1", ...data }));

    await adminArchiveOrganization("org_1");

    expect(organizationUpdate).toHaveBeenCalledTimes(1);
    const updateArg = organizationUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "org_1" });
    expect(updateArg.data.archivedAt).toBeInstanceOf(Date);
    // Slug is rewritten to free the original, not left as-is.
    expect(updateArg.data.slug).toMatch(/^acme-archived-/);
    expect(updateArg.data.slug).not.toBe("acme");
  });

  it("rejects an org that doesn't exist", async () => {
    organizationFindUnique.mockResolvedValue(null);

    await expect(adminArchiveOrganization("org_missing")).rejects.toThrow(/not found/i);
    expect(organizationUpdate).not.toHaveBeenCalled();
  });

  it("rejects an already-archived org rather than double-archiving", async () => {
    organizationFindUnique.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme-archived-xyz",
      archivedAt: new Date(),
    });

    await expect(adminArchiveOrganization("org_1")).rejects.toThrow(/already archived/i);
    expect(organizationUpdate).not.toHaveBeenCalled();
  });
});

describe("adminUnarchiveOrganization", () => {
  it("clears archivedAt", async () => {
    organizationFindUnique.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      archivedAt: new Date(),
    });
    organizationUpdate.mockImplementation(({ data }) => ({ id: "org_1", ...data }));

    await adminUnarchiveOrganization("org_1");

    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { archivedAt: null },
    });
  });

  it("rejects an org that isn't archived", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org_1", name: "Acme", archivedAt: null });

    await expect(adminUnarchiveOrganization("org_1")).rejects.toThrow(/not archived/i);
    expect(organizationUpdate).not.toHaveBeenCalled();
  });

  it("rejects an org that doesn't exist", async () => {
    organizationFindUnique.mockResolvedValue(null);

    await expect(adminUnarchiveOrganization("org_missing")).rejects.toThrow(/not found/i);
  });
});
