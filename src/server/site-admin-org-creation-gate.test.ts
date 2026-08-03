/**
 * src/server/site-admin.ts's org-creation-gate accessors (Phase B, B3/#1095,
 * D6): getOrgCreationPolicy (any authenticated user, status-only),
 * getOrgCreationCodeAdmin / regenerateOrgCreationCode (site-admin only,
 * secret-bearing).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireSiteAdmin = vi.fn();
const requireSession = vi.fn();
vi.mock("@/lib/admin-auth", () => ({
  requireSiteAdmin: (...a: unknown[]) => requireSiteAdmin(...a),
  isSiteAdmin: vi.fn(async () => true),
}));
vi.mock("@/lib/auth-server", () => ({
  requireSession: (...a: unknown[]) => requireSession(...a),
}));

const organizationFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findFirst: (...a: unknown[]) => organizationFindFirst(...a) } },
}));

const getOrgCreationGateSettings = vi.fn();
const generateOrgCreationCode = vi.fn();
vi.mock("@/lib/org-creation-gate", () => ({
  getOrgCreationGateSettings: (...a: unknown[]) => getOrgCreationGateSettings(...a),
  generateOrgCreationCode: (...a: unknown[]) => generateOrgCreationCode(...a),
}));

const getAnyOrgForAudit = vi.fn();
vi.mock("@/lib/audit-org", () => ({
  getAnyOrgForAudit: (...a: unknown[]) => getAnyOrgForAudit(...a),
}));

const logActivity = vi.fn();
vi.mock("@/lib/activity-log", () => ({ logActivity: (...a: unknown[]) => logActivity(...a) }));

const convexMock = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => convexMock),
  withConvexReadRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/site-settings-read", () => ({
  getSiteSettingsFromConvex: vi.fn(async () => ({})),
}));
vi.mock("@/lib/platform", () => ({
  invalidatePlatformNameCache: vi.fn(),
  getPlatformName: vi.fn(async () => "RVLT Flow"),
}));

import {
  getOrgCreationPolicy,
  getOrgCreationCodeAdmin,
  regenerateOrgCreationCode,
} from "./site-admin";

const ADMIN_SESSION = { user: { id: "admin_1", name: "Site Admin" } };

beforeEach(() => {
  vi.clearAllMocks();
  requireSiteAdmin.mockResolvedValue(ADMIN_SESSION);
  requireSession.mockResolvedValue({ user: { id: "user_1" } });
  convexMock.mutation.mockResolvedValue(undefined);
});

describe("getOrgCreationPolicy", () => {
  it("is unconditionally allowed with no code during bootstrap (no org exists yet)", async () => {
    organizationFindFirst.mockResolvedValue(null);
    await expect(getOrgCreationPolicy()).resolves.toEqual({ allowed: true, codeRequired: false });
    // Never even reads the gate settings during bootstrap.
    expect(getOrgCreationGateSettings).not.toHaveBeenCalled();
  });

  it("reflects the toggle + code-enabled flag once an org exists", async () => {
    organizationFindFirst.mockResolvedValue({ id: "org_1" });
    getOrgCreationGateSettings.mockResolvedValue({
      allowOrgCreation: true,
      codeEnabled: true,
      code: "secret",
    });
    await expect(getOrgCreationPolicy()).resolves.toEqual({ allowed: true, codeRequired: true });
  });

  it("never returns the code itself", async () => {
    organizationFindFirst.mockResolvedValue({ id: "org_1" });
    getOrgCreationGateSettings.mockResolvedValue({
      allowOrgCreation: true,
      codeEnabled: true,
      code: "super-secret",
    });
    const result = await getOrgCreationPolicy();
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });

  it("reports not allowed when the toggle is off, regardless of codeEnabled", async () => {
    organizationFindFirst.mockResolvedValue({ id: "org_1" });
    getOrgCreationGateSettings.mockResolvedValue({
      allowOrgCreation: false,
      codeEnabled: true,
      code: "secret",
    });
    await expect(getOrgCreationPolicy()).resolves.toEqual({ allowed: false, codeRequired: false });
  });

  it("requires a session", async () => {
    requireSession.mockRejectedValue(new Error("Unauthorized"));
    await expect(getOrgCreationPolicy()).rejects.toThrow();
  });
});

describe("getOrgCreationCodeAdmin", () => {
  it("requires site admin", async () => {
    requireSiteAdmin.mockRejectedValue(new Error("Access denied. Site admin required."));
    await expect(getOrgCreationCodeAdmin()).rejects.toThrow(/site admin/i);
  });

  it("returns the gate settings verbatim for an admin", async () => {
    getOrgCreationGateSettings.mockResolvedValue({
      allowOrgCreation: true,
      codeEnabled: true,
      code: "abc123",
    });
    await expect(getOrgCreationCodeAdmin()).resolves.toEqual({
      allowOrgCreation: true,
      codeEnabled: true,
      code: "abc123",
    });
  });
});

describe("regenerateOrgCreationCode", () => {
  it("requires site admin", async () => {
    requireSiteAdmin.mockRejectedValue(new Error("Access denied. Site admin required."));
    await expect(regenerateOrgCreationCode()).rejects.toThrow(/site admin/i);
    expect(convexMock.mutation).not.toHaveBeenCalled();
  });

  it("generates a fresh code, stores it via upsertSingleton, and returns it", async () => {
    generateOrgCreationCode.mockReturnValue("fresh-code-123");
    getAnyOrgForAudit.mockResolvedValue({ id: "org_1" });

    const result = await regenerateOrgCreationCode();

    expect(result).toEqual({ code: "fresh-code-123" });
    expect(convexMock.mutation).toHaveBeenCalledTimes(1);
    const [, args] = convexMock.mutation.mock.calls[0];
    expect(args.patch).toEqual({ orgCreationCode: "fresh-code-123" });
  });

  it("logs the regeneration without leaking the code into the audit entry", async () => {
    generateOrgCreationCode.mockReturnValue("fresh-code-123");
    getAnyOrgForAudit.mockResolvedValue({ id: "org_1" });

    await regenerateOrgCreationCode();

    expect(logActivity).toHaveBeenCalledTimes(1);
    const [logArgs] = logActivity.mock.calls[0];
    expect(JSON.stringify(logArgs)).not.toContain("fresh-code-123");
    expect(logArgs.organizationId).toBe("org_1");
  });

  it("still regenerates when there's no org yet for the audit log (best-effort)", async () => {
    generateOrgCreationCode.mockReturnValue("fresh-code-123");
    getAnyOrgForAudit.mockResolvedValue(null);

    await expect(regenerateOrgCreationCode()).resolves.toEqual({ code: "fresh-code-123" });
    expect(logActivity).not.toHaveBeenCalled();
  });
});
