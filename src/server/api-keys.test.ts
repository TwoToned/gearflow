import { describe, it, expect, vi, beforeEach } from "vitest";

const ctx = { organizationId: "org_1", userId: "user_1", userName: "Ada" };
vi.mock("@/lib/org-context", () => ({
  requirePermission: vi.fn(async () => ctx),
  getOrgContext: vi.fn(async () => ctx),
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/api-key", () => ({
  generateApiKey: () => ({ raw: "gf_live_SECRET", prefix: "gf_live_ab", tokenHash: "hash_of_secret" }),
}));

const prismaMock = vi.hoisted(() => ({
  apiKey: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  member: { findFirst: vi.fn() },
  organization: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { createApiKey, revokeApiKey, setOrgApiKillSwitch, listApiKeys } from "@/server/api-keys";
import { logActivity } from "@/lib/activity-log";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.member.findFirst.mockResolvedValue({ id: "mem_1" });
  prismaMock.apiKey.create.mockResolvedValue({ id: "key_1", name: "Agent", prefix: "gf_live_ab" });
});

describe("createApiKey", () => {
  it("stores only the hash, returns the raw secret once, and audits", async () => {
    const res = await createApiKey({ name: "Agent", scopes: ["project:manage_line_items"] });

    expect(res.token).toBe("gf_live_SECRET");
    const createArg = prismaMock.apiKey.create.mock.calls[0][0];
    expect(createArg.data.tokenHash).toBe("hash_of_secret");
    expect(createArg.data.token).toBeUndefined(); // raw secret is never persisted
    expect(createArg.data.scopes).toBe('["project:manage_line_items"]');
    expect(createArg.data.actingUserId).toBe("user_1"); // defaults to creator
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "apiKey", action: "create" }),
    );
  });

  it("rejects an acting user who is not a member of the org", async () => {
    prismaMock.member.findFirst.mockResolvedValue(null);
    await expect(
      createApiKey({ name: "X", scopes: [], actingUserId: "outsider" }),
    ).rejects.toThrow(/member of this organization/i);
    expect(prismaMock.apiKey.create).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    await expect(createApiKey({ name: "  ", scopes: [] })).rejects.toThrow(/name is required/i);
  });
});

describe("revokeApiKey", () => {
  it("deactivates + stamps revokedAt and audits", async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue({ id: "key_1", name: "Agent" });
    await revokeApiKey("key_1");
    const updateArg = prismaMock.apiKey.update.mock.calls[0][0];
    expect(updateArg.data.isActive).toBe(false);
    expect(updateArg.data.revokedAt).toBeInstanceOf(Date);
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "delete" }));
  });

  it("throws when the key is not in this org", async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue(null);
    await expect(revokeApiKey("nope")).rejects.toThrow(/not found/i);
  });
});

describe("setOrgApiKillSwitch", () => {
  it("sets a timestamp when enabled and clears it when disabled", async () => {
    await setOrgApiKillSwitch(true);
    expect(prismaMock.organization.update.mock.calls[0][0].data.apiKillSwitchAt).toBeInstanceOf(Date);

    await setOrgApiKillSwitch(false);
    expect(prismaMock.organization.update.mock.calls[1][0].data.apiKillSwitchAt).toBeNull();
  });
});

describe("listApiKeys", () => {
  it("returns keys + kill-switch state without any secret", async () => {
    prismaMock.apiKey.findMany.mockResolvedValue([{ id: "key_1", prefix: "gf_live_ab", name: "Agent" }]);
    prismaMock.organization.findUnique.mockResolvedValue({ apiKillSwitchAt: null });

    const res = await listApiKeys();

    expect(res.keys).toHaveLength(1);
    expect(res.keys[0]).not.toHaveProperty("tokenHash");
    expect(res.keys[0]).not.toHaveProperty("token");
    expect(res.apiKillSwitchAt).toBeNull();
  });
});
