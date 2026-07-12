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

// ApiKey is a Convex domain now — mock the Convex client. member/organization stay
// on Postgres (Better-Auth), so the prisma mock keeps those.
const convexMock = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn(async () => convexMock) }));

const prismaMock = vi.hoisted(() => ({
  member: { findFirst: vi.fn() },
  organization: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { createApiKey, revokeApiKey, setOrgApiKillSwitch, listApiKeys } from "@/server/api-keys";
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
  it("sets a timestamp when enabled and clears it when disabled", async () => {
    await setOrgApiKillSwitch(true);
    expect(prismaMock.organization.update.mock.calls[0][0].data.apiKillSwitchAt).toBeInstanceOf(Date);

    await setOrgApiKillSwitch(false);
    expect(prismaMock.organization.update.mock.calls[1][0].data.apiKillSwitchAt).toBeNull();
  });
});

describe("listApiKeys", () => {
  it("returns keys + kill-switch state without any secret", async () => {
    convexMock.query.mockResolvedValue([
      { id: "key_1", prefix: "gf_live_ab", name: "Agent", tokenHash: "hash", actingUserId: "user_1", createdAt: 1000 },
    ]);
    prismaMock.organization.findUnique.mockResolvedValue({ apiKillSwitchAt: null });

    const res = await listApiKeys();

    expect(res.keys).toHaveLength(1);
    expect(res.keys[0]).not.toHaveProperty("tokenHash");
    expect(res.keys[0]).not.toHaveProperty("token");
    expect(res.apiKillSwitchAt).toBeNull();
  });
});
