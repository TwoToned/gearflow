import { describe, it, expect, vi, beforeEach } from "vitest";

const ctx = { organizationId: "org_1", userId: "user_1", userName: "Ada" };
vi.mock("@/lib/org-context", () => ({
  requirePermission: vi.fn(async () => ctx),
  getOrgContext: vi.fn(async () => ctx),
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/api-key", () => ({
  generateApiKey: () => ({ raw: "gf_live_SECRET", prefix: "gf_live_ab", tokenHash: "hash_of_secret" }),
  assertScopesWithinActor: vi.fn(),
}));
vi.mock("@/lib/request-actor", () => ({ getAmbientActor: () => undefined }));

// ApiKey + org kill-switch (org-settings) are Convex domains now — mock the Convex
// client. member stays on Postgres (Better-Auth), so the prisma mock keeps that.
const convexMock = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => convexMock),
  withConvexReadRetry: (fn: () => unknown) => fn(),
}));

const prismaMock = vi.hoisted(() => ({
  member: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import {
  createApiKey,
  revokeApiKey,
  setOrgApiKillSwitch,
  listApiKeys,
  rotateApiKey,
  getApiKeyRequestLog,
} from "@/server/api-keys";
import { logActivity } from "@/lib/activity-log";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.member.findFirst.mockResolvedValue({ id: "mem_1" });
  convexMock.mutation.mockResolvedValue({ id: "key_1", name: "Agent" });
  convexMock.query.mockResolvedValue([]);
});

describe("createApiKey", () => {
  it("stores only the hash via Convex, returns the raw secret once, and audits", async () => {
    const res = await createApiKey({ name: "Agent", scopes: ["project:manage_line_items"] });

    expect(res.token).toBe("gf_live_SECRET");
    // The single create mutation's payload
    const createArg = convexMock.mutation.mock.calls[0][1] as Record<string, unknown>;
    expect(createArg.tokenHash).toBe("hash_of_secret");
    expect(createArg.token).toBeUndefined(); // raw secret is never persisted
    expect(createArg.scopes).toBe('["project:manage_line_items"]');
    expect(createArg.actingUserId).toBe("user_1"); // defaults to creator
    // never round-trips the secret back to the client
    expect(res.key).not.toHaveProperty("tokenHash");
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "apiKey", action: "create" }),
    );
  });

  it("rejects an acting user who is not a member of the org", async () => {
    prismaMock.member.findFirst.mockResolvedValue(null);
    await expect(
      createApiKey({ name: "X", scopes: [], actingUserId: "outsider" }),
    ).rejects.toThrow(/member of this organization/i);
    expect(convexMock.mutation).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    await expect(createApiKey({ name: "  ", scopes: [] })).rejects.toThrow(/name is required/i);
  });

  it("passes noFinancials through to the create mutation and the audit row (decision 6)", async () => {
    const res = await createApiKey({ name: "Finance bot", scopes: ["invoice:read"], noFinancials: true });

    const createArg = convexMock.mutation.mock.calls[0][1] as Record<string, unknown>;
    expect(createArg.noFinancials).toBe(true);
    expect(res.key.noFinancials).toBe(true);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ noFinancials: true }) }),
    );
  });

  it("defaults noFinancials to false when omitted", async () => {
    const res = await createApiKey({ name: "Agent", scopes: [] });
    const createArg = convexMock.mutation.mock.calls[0][1] as Record<string, unknown>;
    expect(createArg.noFinancials).toBe(false);
    expect(res.key.noFinancials).toBe(false);
  });
});

describe("revokeApiKey", () => {
  it("revokes via the org-guarded Convex mutation and audits", async () => {
    convexMock.mutation.mockResolvedValue({ id: "key_1", name: "Agent" });
    await revokeApiKey("key_1");
    expect(convexMock.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "key_1", orgId: "org_1" }),
    );
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "delete" }));
  });

  it("throws when the Convex mutation rejects (key not in this org)", async () => {
    convexMock.mutation.mockRejectedValue(new Error("apiKey not found"));
    await expect(revokeApiKey("nope")).rejects.toThrow(/not found/i);
  });
});

describe("setOrgApiKillSwitch", () => {
  it("toggles the kill switch via the Convex org-settings mutation", async () => {
    convexMock.mutation.mockResolvedValue({ apiKillSwitchAt: Date.now() });
    await setOrgApiKillSwitch(true);
    expect(convexMock.mutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: "org_1", enabled: true }),
    );

    convexMock.mutation.mockResolvedValue({ apiKillSwitchAt: null });
    await setOrgApiKillSwitch(false);
    expect(convexMock.mutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: "org_1", enabled: false }),
    );
  });
});

describe("listApiKeys", () => {
  it("returns keys + kill-switch state without any secret", async () => {
    // apiKeys.list → keys; orgSettings.getByOrg (has `organizationId`) → no kill switch.
    convexMock.query.mockImplementation((_ref: unknown, args: Record<string, unknown>) => {
      if (args && "organizationId" in args) return Promise.resolve({ apiKillSwitchAt: undefined });
      return Promise.resolve([
        { id: "key_1", prefix: "gf_live_ab", name: "Agent", tokenHash: "hash", actingUserId: "user_1", createdAt: 1000 },
      ]);
    });

    const res = await listApiKeys();

    expect(res.keys).toHaveLength(1);
    expect(res.keys[0]).not.toHaveProperty("tokenHash");
    expect(res.keys[0]).not.toHaveProperty("token");
    expect(res.apiKillSwitchAt).toBeNull();
  });
});

describe("rotateApiKey", () => {
  it("mints a new secret, sends a grace-window expiry, and returns the raw token once", async () => {
    convexMock.mutation.mockResolvedValue({ id: "key_1", name: "Agent", prefix: "gf_live_ab" });

    const res = await rotateApiKey("key_1", 30);

    expect(res.token).toBe("gf_live_SECRET");
    const rotateArg = convexMock.mutation.mock.calls[0][1] as Record<string, unknown>;
    expect(rotateArg.id).toBe("key_1");
    expect(rotateArg.orgId).toBe("org_1");
    expect(rotateArg.tokenHash).toBe("hash_of_secret");
    expect(typeof rotateArg.previousTokenHashExpiresAt).toBe("number");
    expect(res.graceMinutes).toBe(30);
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "update", entityType: "apiKey" }));
  });

  it("clamps an over-cap grace window to 24h", async () => {
    convexMock.mutation.mockResolvedValue({ id: "key_1", name: "Agent", prefix: "gf_live_ab" });

    const res = await rotateApiKey("key_1", 10_000);
    expect(res.graceMinutes).toBe(24 * 60);
    const overCapArg = convexMock.mutation.mock.calls[0][1] as Record<string, unknown>;
    expect(overCapArg.previousTokenHashExpiresAt as number).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60_000 + 1000);
  });

  it("defaults to a 60-minute grace window when omitted", async () => {
    convexMock.mutation.mockResolvedValue({ id: "key_1", name: "Agent", prefix: "gf_live_ab" });
    const res = await rotateApiKey("key_1");
    expect(res.graceMinutes).toBe(60);
  });

  it("throws when the Convex mutation rejects (key not in this org)", async () => {
    convexMock.mutation.mockRejectedValue(new Error("apiKey not found"));
    await expect(rotateApiKey("nope")).rejects.toThrow(/not found/i);
  });
});

describe("getApiKeyRequestLog", () => {
  it("returns the log only when the key belongs to the caller's org", async () => {
    convexMock.query.mockImplementation((_ref: unknown, args: Record<string, unknown>) => {
      if (args && "apiKeyId" in args && !("orgId" in args)) {
        return Promise.resolve([{ ts: 1, operation: "assets.list", kind: "query", status: "success", latencyMs: 12 }]);
      }
      return Promise.resolve([{ id: "key_1" }]);
    });

    const res = await getApiKeyRequestLog("key_1", 50);
    expect(res.entries).toHaveLength(1);
  });

  it("rejects a key id that doesn't belong to this org (R-8.4.3)", async () => {
    convexMock.query.mockResolvedValue([{ id: "some_other_key" }]);
    await expect(getApiKeyRequestLog("key_1")).rejects.toThrow(/not found/i);
  });
});
