import { describe, it, expect, vi, beforeEach } from "vitest";

const ctx = { organizationId: "org_1", userId: "user_1", userName: "Ada" };
vi.mock("@/lib/org-context", () => ({
  requirePermission: vi.fn(async () => ctx),
  getOrgContext: vi.fn(async () => ctx),
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    miraOrgSettings: {
      getForOrg: "miraOrgSettings.getForOrg",
      create: "miraOrgSettings.create",
      patch: "miraOrgSettings.patch",
      disconnectOpenRouter: "miraOrgSettings.disconnectOpenRouter",
    },
  },
}));

const convexMock = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn(async () => convexMock) }));

vi.mock("@/lib/crypto/secret-vault", () => ({ encryptSecret: (raw: string) => `enc(${raw})` }));

vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));

const { getMiraSettings, saveMiraSettings, disconnectMiraOpenRouter, isMiraConfigured } = await import("@/server/mira-settings");

beforeEach(() => {
  vi.clearAllMocks();
  convexMock.query.mockResolvedValue(null);
  convexMock.mutation.mockResolvedValue(undefined);
});

describe("isMiraConfigured", () => {
  it("needs no permission — every member gets a boolean, never the key", async () => {
    convexMock.query.mockResolvedValue({ openRouterKeyEncrypted: "enc(secret)" });
    const res = await isMiraConfigured();
    expect(res).toEqual({ configured: true });
    expect(JSON.stringify(res)).not.toContain("secret");
  });

  it("is false when nothing is configured, or the row has no key", async () => {
    convexMock.query.mockResolvedValue(null);
    expect(await isMiraConfigured()).toEqual({ configured: false });

    convexMock.query.mockResolvedValue({ openRouterKeyEncrypted: undefined });
    expect(await isMiraConfigured()).toEqual({ configured: false });
  });
});

describe("getMiraSettings", () => {
  it("never exposes the encrypted key — only whether one is configured", async () => {
    convexMock.query.mockResolvedValue({ id: "s1", openRouterKeyEncrypted: "enc(secret)", model: "m", writeAccessEnabled: true, updatedAt: 123 });
    const res = await getMiraSettings();
    expect(res).toEqual({ hasApiKey: true, model: "m", writeAccessEnabled: true, updatedAt: 123 });
    expect(JSON.stringify(res)).not.toContain("secret");
  });

  it("defaults cleanly when nothing is configured yet", async () => {
    const res = await getMiraSettings();
    expect(res).toEqual({ hasApiKey: false, model: "", writeAccessEnabled: false, updatedAt: null });
  });
});

describe("saveMiraSettings", () => {
  it("creates a new row, encrypting the submitted key", async () => {
    await saveMiraSettings({ openRouterApiKey: "sk-or-v1-abcdefghijklmnop", model: "anthropic/claude-sonnet-4.5", writeAccessEnabled: false });
    expect(convexMock.mutation).toHaveBeenCalledWith(
      "miraOrgSettings.create",
      expect.objectContaining({ organizationId: "org_1", openRouterKeyEncrypted: "enc(sk-or-v1-abcdefghijklmnop)", model: "anthropic/claude-sonnet-4.5", writeAccessEnabled: false }),
    );
  });

  it("patches an existing row, leaving the key untouched when not resubmitted", async () => {
    convexMock.query.mockResolvedValue({ id: "s1", openRouterKeyEncrypted: "enc(old)", model: "old/model", writeAccessEnabled: false });
    await saveMiraSettings({ openRouterApiKey: "", model: "new/model", writeAccessEnabled: true });
    expect(convexMock.mutation).toHaveBeenCalledWith(
      "miraOrgSettings.patch",
      expect.objectContaining({ id: "s1", openRouterKeyEncrypted: undefined, model: "new/model", writeAccessEnabled: true }),
    );
  });

  it("rejects a too-short API key before ever touching Convex", async () => {
    await expect(saveMiraSettings({ openRouterApiKey: "short", model: "m", writeAccessEnabled: false })).rejects.toThrow();
    expect(convexMock.mutation).not.toHaveBeenCalled();
  });
});

describe("disconnectMiraOpenRouter", () => {
  it("clears the key when a row exists", async () => {
    convexMock.query.mockResolvedValue({ id: "s1" });
    await disconnectMiraOpenRouter();
    expect(convexMock.mutation).toHaveBeenCalledWith("miraOrgSettings.disconnectOpenRouter", { id: "s1", organizationId: "org_1", updatedById: "user_1" });
  });

  it("no-ops when nothing is configured", async () => {
    await disconnectMiraOpenRouter();
    expect(convexMock.mutation).not.toHaveBeenCalled();
  });
});
