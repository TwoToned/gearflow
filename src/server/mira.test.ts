import { describe, it, expect, vi, beforeEach } from "vitest";

const ctx = { organizationId: "org_1", userId: "user_1", userName: "Ada" };
vi.mock("@/lib/org-context", () => ({ getOrgContext: vi.fn(async () => ctx) }));

const convexMock = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn(async () => convexMock) }));

vi.mock("@/lib/api-key", () => ({
  generateApiKey: () => ({ raw: "gf_live_MIRA_SECRET", prefix: "gf_live_mi", tokenHash: "hash_of_mira_secret" }),
}));

vi.mock("@/lib/api-key-presets", () => ({
  findApiKeyPreset: (id: string) =>
    id === "read_only_agent" ? { id, scopes: ["project:read", "asset:read"], noFinancialsDefault: true } : undefined,
}));

vi.mock("@/lib/crypto/secret-vault", () => ({
  encryptSecret: (raw: string) => `enc(${raw})`,
  decryptSecret: (enc: string) => enc.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

const dispatch = vi.fn();
vi.mock("@/lib/api/dispatcher", () => ({ dispatch: (...args: unknown[]) => dispatch(...args) }));

const { askMira } = await import("@/server/mira");

beforeEach(() => {
  vi.clearAllMocks();
  convexMock.query.mockResolvedValue(null); // no existing miraKeys row by default
  convexMock.mutation.mockResolvedValue(undefined);
});

describe("askMira", () => {
  it("rejects an empty question without provisioning anything", async () => {
    await expect(askMira("   ", null)).rejects.toThrow(/ask mira something/i);
    expect(convexMock.query).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("returns a helpful default and never provisions a key when nothing routes", async () => {
    const res = await askMira("what's the weather", null);
    expect(res.operation).toBeNull();
    expect(res.answer).toMatch(/project you're currently viewing/i);
    expect(convexMock.query).not.toHaveBeenCalled();
    expect(convexMock.mutation).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("provisions a Mira key on first use (read_only_agent preset, acting as the caller)", async () => {
    dispatch.mockResolvedValue({ status: 200, body: { data: [{ id: "a1" }], requestId: "req_1", warnings: [] } });

    await askMira("list assets", null);

    // apiKeys.create
    const apiKeysCreateCall = convexMock.mutation.mock.calls.find((c) => c[1]?.tokenHash === "hash_of_mira_secret");
    expect(apiKeysCreateCall).toBeTruthy();
    expect(apiKeysCreateCall![1]).toMatchObject({
      organizationId: "org_1",
      name: "Mira Assistant",
      scopes: JSON.stringify(["project:read", "asset:read"]),
      actingUserId: "user_1",
      createdById: "user_1",
      noFinancials: true,
    });

    // miraKeys.create
    const miraKeysCreateCall = convexMock.mutation.mock.calls.find((c) => "encryptedToken" in (c[1] ?? {}));
    expect(miraKeysCreateCall![1]).toMatchObject({
      organizationId: "org_1",
      userId: "user_1",
      encryptedToken: "enc(gf_live_MIRA_SECRET)",
    });

    // dispatch called with the freshly-minted raw token as a bearer header
    expect(dispatch).toHaveBeenCalledWith("assets.list", { args: {} }, "Bearer gf_live_MIRA_SECRET", expect.any(String));
  });

  it("reuses an existing Mira key without re-provisioning", async () => {
    convexMock.query.mockResolvedValue({ encryptedToken: "enc(existing_token)", apiKeyId: "key_1" });
    dispatch.mockResolvedValue({ status: 200, body: { data: [], requestId: "req_2", warnings: [] } });

    await askMira("list assets", null);

    expect(convexMock.mutation).not.toHaveBeenCalled(); // no create calls
    expect(dispatch).toHaveBeenCalledWith("assets.list", { args: {} }, "Bearer existing_token", expect.any(String));
  });

  it("routes a project-context question to projectDetail.bundle with the page's entityId", async () => {
    convexMock.query.mockResolvedValue({ encryptedToken: "enc(tok)", apiKeyId: "key_1" });
    dispatch.mockResolvedValue({
      status: 200,
      body: { data: { project: { name: "Gig", projectNumber: "P-1", status: "SENT" } }, requestId: "req_3", warnings: [] },
    });

    const res = await askMira("what's the status", { entityType: "project", entityId: "proj_9" });

    expect(dispatch).toHaveBeenCalledWith(
      "projectDetail.bundle",
      { args: { projectId: "proj_9" } },
      "Bearer tok",
      expect.any(String),
    );
    expect(res.answer).toBe("Gig (P-1) is currently SENT.");
  });

  it("surfaces a dispatch error as a friendly message instead of throwing", async () => {
    convexMock.query.mockResolvedValue({ encryptedToken: "enc(tok)", apiKeyId: "key_1" });
    dispatch.mockResolvedValue({ status: 403, body: { error: { message: "Missing scope." } } });

    const res = await askMira("list assets", null);
    expect(res.answer).toMatch(/couldn't fetch that/i);
    expect(res.answer).toMatch(/Missing scope/);
  });
});
