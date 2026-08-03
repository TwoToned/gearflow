import { describe, it, expect, vi, beforeEach } from "vitest";

const orgCtx = { organizationId: "org_1", userId: "user_1", userName: "Ada" };
vi.mock("@/lib/org-context", () => ({
  getOrgContext: vi.fn(async () => orgCtx),
  getCurrentRole: vi.fn(async () => "manager"),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { organization: { findUnique: vi.fn(async () => ({ name: "Acme Rentals" })) } } }));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    apiKeys: { create: "apiKeys.create" },
    miraKeys: { getForUser: "miraKeys.getForUser", create: "miraKeys.create" },
    miraOrgSettings: { getForOrg: "miraOrgSettings.getForOrg" },
    miraConversations: {
      getActiveForUser: "miraConversations.getActiveForUser",
      create: "miraConversations.create",
      touch: "miraConversations.touch",
      archive: "miraConversations.archive",
    },
    miraMessages: {
      listForConversation: "miraMessages.listForConversation",
      append: "miraMessages.append",
      getById: "miraMessages.getById",
      clearPendingConfirmation: "miraMessages.clearPendingConfirmation",
    },
  },
}));

const convexMock = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: vi.fn(async () => convexMock) }));

vi.mock("@/lib/api-key", () => ({
  generateApiKey: () => ({ raw: "gf_live_MIRA_SECRET", prefix: "gf_live_mi", tokenHash: "hash_of_mira_secret" }),
}));

vi.mock("@/lib/api-key-presets", () => ({
  findApiKeyPreset: (id: string) => {
    if (id === "read_only_agent") return { id, scopes: ["project:read", "asset:read"], noFinancialsDefault: true };
    if (id === "full_agent") return { id, scopes: ["project:read", "asset:read", "project:create"], noFinancialsDefault: false };
    return undefined;
  },
}));

vi.mock("@/lib/crypto/secret-vault", () => ({
  encryptSecret: (raw: string) => `enc(${raw})`,
  decryptSecret: (enc: string) => enc.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

const dispatch = vi.fn();
vi.mock("@/lib/api/dispatcher", () => ({ dispatch: (...args: unknown[]) => dispatch(...args) }));

vi.mock("@/lib/mira/tool-defs", () => ({
  buildMiraTools: vi.fn(() => [{ name: "search_assets", description: "d", operation: "assets.list", isWrite: false, danger: null, parameters: {} }]),
  findMiraTool: (tools: { name: string }[], name: string) => tools.find((t) => t.name === name),
}));

const runMiraAgentLoop = vi.fn();
vi.mock("@/lib/mira/agent-loop", () => ({ runMiraAgentLoop: (...args: unknown[]) => runMiraAgentLoop(...args) }));

vi.mock("@/lib/mira/system-prompt", () => ({ buildMiraSystemPrompt: () => "system prompt" }));

const {
  sendMiraMessage,
  confirmMiraPendingAction,
  dismissMiraPendingAction,
  getMiraConversation,
  clearMiraConversation,
} = await import("@/server/mira");

function queryImpl(overrides: Record<string, unknown> = {}) {
  return (fnRef: string, _args: Record<string, unknown>) => {
    if (fnRef in overrides) return overrides[fnRef];
    if (fnRef === "miraKeys.getForUser") return null;
    if (fnRef === "miraOrgSettings.getForOrg") return { openRouterKeyEncrypted: "enc(sk-or-key)", model: "some/model", writeAccessEnabled: false };
    if (fnRef === "miraConversations.getActiveForUser") return null;
    if (fnRef === "miraMessages.listForConversation") return [];
    return undefined;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  convexMock.query.mockImplementation(queryImpl());
  convexMock.mutation.mockResolvedValue(undefined);
  runMiraAgentLoop.mockResolvedValue({ appended: [{ role: "assistant", content: "Here you go." }], pendingConfirmation: null, toolTrace: [] });
});

describe("sendMiraMessage", () => {
  it("rejects an empty question without touching Convex", async () => {
    await expect(sendMiraMessage("   ", null)).rejects.toThrow(/ask mira something/i);
    expect(convexMock.query).not.toHaveBeenCalled();
  });

  it("returns a not-configured message and never provisions anything when the org has no OpenRouter key", async () => {
    convexMock.query.mockImplementation(queryImpl({ "miraOrgSettings.getForOrg": null }));
    const res = await sendMiraMessage("hello", null);
    expect(res.newMessages[0]!.content).toMatch(/isn't set up for this org/i);
    expect(convexMock.mutation).not.toHaveBeenCalled();
    expect(runMiraAgentLoop).not.toHaveBeenCalled();
  });

  it("provisions a read_only_agent Mira key when the org hasn't enabled write access", async () => {
    await sendMiraMessage("hi", null);

    const apiKeyCreate = convexMock.mutation.mock.calls.find((c) => c[0] === "apiKeys.create");
    expect(apiKeyCreate![1]).toMatchObject({ scopes: JSON.stringify(["project:read", "asset:read"]), actingUserId: "user_1" });
    expect(runMiraAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-or-key", model: "some/model" }),
    );
  });

  it("provisions a full_agent Mira key when the org has enabled write access", async () => {
    convexMock.query.mockImplementation(
      queryImpl({ "miraOrgSettings.getForOrg": { openRouterKeyEncrypted: "enc(sk-or-key)", model: "m", writeAccessEnabled: true } }),
    );
    await sendMiraMessage("hi", null);
    const apiKeyCreate = convexMock.mutation.mock.calls.find((c) => c[0] === "apiKeys.create");
    expect(apiKeyCreate![1].scopes).toBe(JSON.stringify(["project:read", "asset:read", "project:create"]));
  });

  it("passes the org's custom baseUrl through to the agent loop when set, omits it otherwise", async () => {
    await sendMiraMessage("hi", null);
    expect(runMiraAgentLoop).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: undefined }));

    convexMock.query.mockImplementation(
      queryImpl({ "miraOrgSettings.getForOrg": { openRouterKeyEncrypted: "enc(sk-key)", model: "m", baseUrl: "https://my-backend.example/v1", writeAccessEnabled: false } }),
    );
    await sendMiraMessage("hi again", null);
    expect(runMiraAgentLoop).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: "https://my-backend.example/v1" }));
  });

  it("reuses an existing Mira key instead of re-provisioning", async () => {
    convexMock.query.mockImplementation(queryImpl({ "miraKeys.getForUser": { encryptedToken: "enc(existing)", apiKeyId: "key_1" } }));
    await sendMiraMessage("hi", null);
    expect(convexMock.mutation.mock.calls.find((c) => c[0] === "apiKeys.create")).toBeUndefined();
  });

  it("creates a conversation, persists the user + appended messages, and touches the conversation", async () => {
    await sendMiraMessage("hi there", null);

    const conversationCreate = convexMock.mutation.mock.calls.find((c) => c[0] === "miraConversations.create");
    expect(conversationCreate).toBeTruthy();

    const appendCalls = convexMock.mutation.mock.calls.filter((c) => c[0] === "miraMessages.append");
    expect(appendCalls).toHaveLength(2); // the user message + the one appended assistant message
    expect(appendCalls[0]![1]).toMatchObject({ role: "user", content: "hi there" });
    expect(appendCalls[1]![1]).toMatchObject({ role: "assistant", content: "Here you go." });

    expect(convexMock.mutation.mock.calls.some((c) => c[0] === "miraConversations.touch")).toBe(true);
  });

  it("stashes pendingConfirmation on the LAST assistant message only", async () => {
    const pending = { operation: "warehouseWrites.checkOutItems", args: {}, idempotencyKey: "idem-1", summary: "would dispatch" };
    runMiraAgentLoop.mockResolvedValue({
      appended: [
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "dispatch_gear", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "c1", name: "dispatch_gear", content: "{}" },
        { role: "assistant", content: "Confirm?" },
      ],
      pendingConfirmation: pending,
      toolTrace: [],
    });

    await sendMiraMessage("dispatch it", null);
    const appendCalls = convexMock.mutation.mock.calls.filter((c) => c[0] === "miraMessages.append");
    const last = appendCalls.at(-1)![1];
    expect(last).toMatchObject({ role: "assistant", content: "Confirm?", pendingConfirmation: pending });
    // Earlier assistant/tool rows in the same turn carry no pending confirmation.
    expect(appendCalls[1]![1].pendingConfirmation).toBeNull();
  });
});

describe("confirmMiraPendingAction", () => {
  const pending = { operation: "warehouseWrites.checkOutItems", args: { projectId: "p1" }, idempotencyKey: "idem-1", summary: "would dispatch" };

  it("throws when the message has nothing pending confirmation", async () => {
    convexMock.query.mockImplementation(queryImpl({ "miraMessages.getById": { id: "m1", pendingConfirmation: null } }));
    await expect(confirmMiraPendingAction("m1")).rejects.toThrow(/nothing pending confirmation/i);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("replays the exact stored operation/args/idempotencyKey with confirm:true", async () => {
    convexMock.query.mockImplementation(
      queryImpl({
        "miraMessages.getById": { id: "m1", pendingConfirmation: pending },
        "miraConversations.getActiveForUser": { id: "conv_1" },
      }),
    );
    dispatch.mockResolvedValue({ status: 200, body: { data: { ok: true } } });

    await confirmMiraPendingAction("m1");

    expect(dispatch).toHaveBeenCalledWith(
      "warehouseWrites.checkOutItems",
      { args: { projectId: "p1" }, idempotencyKey: "idem-1", confirm: true },
      "Bearer gf_live_MIRA_SECRET",
      expect.any(String),
    );
    expect(convexMock.mutation.mock.calls.some((c) => c[0] === "miraMessages.clearPendingConfirmation" && c[1].id === "m1")).toBe(true);
  });
});

describe("dismissMiraPendingAction", () => {
  it("clears the pending confirmation without calling dispatch", async () => {
    await dismissMiraPendingAction("m1");
    expect(dispatch).not.toHaveBeenCalled();
    expect(convexMock.mutation).toHaveBeenCalledWith("miraMessages.clearPendingConfirmation", { id: "m1", organizationId: "org_1" });
  });
});

describe("getMiraConversation / clearMiraConversation", () => {
  it("returns an empty conversation when none exists yet", async () => {
    const res = await getMiraConversation();
    expect(res).toEqual({ conversationId: null, messages: [] });
  });

  it("returns persisted messages for an active conversation", async () => {
    convexMock.query.mockImplementation(
      queryImpl({ "miraConversations.getActiveForUser": { id: "conv_1" }, "miraMessages.listForConversation": [{ id: "m1", role: "user", content: "hi" }] }),
    );
    const res = await getMiraConversation();
    expect(res.conversationId).toBe("conv_1");
    expect(res.messages).toHaveLength(1);
  });

  it("clearMiraConversation archives the active conversation, no-ops when none exists", async () => {
    await clearMiraConversation();
    expect(convexMock.mutation.mock.calls.some((c) => c[0] === "miraConversations.archive")).toBe(false);

    convexMock.query.mockImplementation(queryImpl({ "miraConversations.getActiveForUser": { id: "conv_1" } }));
    await clearMiraConversation();
    expect(convexMock.mutation).toHaveBeenCalledWith("miraConversations.archive", { id: "conv_1", organizationId: "org_1", userId: "user_1" });
  });
});
