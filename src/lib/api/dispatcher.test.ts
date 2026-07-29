import { describe, test, expect, vi, beforeEach } from "vitest";

/**
 * Dispatcher tests (design §7-§11, #998). The Convex round-trip itself (RBAC,
 * scopes, lifecycle locks, overbooking) is proven by the convex/*.test.ts
 * suite via convex-test — that's a simulated Convex runtime, not something
 * Node-side dispatcher code can reach into. What's tested HERE is everything
 * the dispatcher owns before/after that call: registry lookup + 404,
 * idempotency orchestration, and that a caller-supplied identity/org/clock
 * never survives to reach Convex. `agent.client.query/mutation` and the
 * idempotency ledger are mocked at the boundary; the arg values THEY receive
 * are asserted directly, so a regression here is "the dispatcher would have
 * sent the wrong thing," not "the mock was wrong."
 */

const mockClient = { query: vi.fn(), mutation: vi.fn() };
const mockAgent = {
  key: { id: "key_1", organizationId: "org_A", actingUserId: "user_1" },
  actor: { organizationId: "org_A", userId: "user_1", userName: "Ada", actorType: "apiKey" as const, apiKeyId: "key_1", scopes: ["*"] },
  client: mockClient,
};

const authenticateAgentRequest = vi.fn(async () => mockAgent);
vi.mock("./agent-auth", () => ({
  parseBearerToken: (header: string | null) => {
    const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
    return m?.[1] ?? null;
  },
  authenticateAgentRequest: (...args: unknown[]) => authenticateAgentRequest(...(args as [])),
}));

const logApiRequest = vi.fn<(entry: unknown) => Promise<void>>(async () => {});
const spendAgentReadLimit = vi.fn<(apiKeyId: string) => Promise<void>>(async () => {});
vi.mock("./request-log", () => ({
  logApiRequest: (...args: unknown[]) => logApiRequest(args[0]),
  spendAgentReadLimit: (...args: unknown[]) => spendAgentReadLimit(...(args as [string])),
}));

const idempotencyClient = { mutation: vi.fn() };
vi.mock("../convex-client", () => ({
  getConvexClient: async () => idempotencyClient,
}));

const { dispatch } = await import("./dispatcher");
const { getFunctionName } = await import("convex/server");

function auth(header = "Bearer gf_live_test") {
  return header;
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateAgentRequest.mockResolvedValue(mockAgent);
  idempotencyClient.mutation.mockResolvedValue(undefined);
});

describe("dispatch — closed by default", () => {
  test("an unknown operation is a 404 UNKNOWN_OPERATION", async () => {
    const result = await dispatch("totally.madeUp", { args: {} }, auth(), "req_1");
    expect(result.status).toBe(404);
    expect((result.body as { error: { code: string } }).error.code).toBe("UNKNOWN_OPERATION");
  });

  test("a real but non-agent-reachable operation is ALSO a 404 — it doesn't leak as 403", async () => {
    // globalSearch.search is (as of the Phase 5 sweep, #1001) the one
    // remaining read on the resource-less requireOrgRead guard — a
    // deliberate denial (14-entity blend search has no single resource to
    // scope against), not an oversight. `locations.list`, this test's
    // previous target, was migrated to `requireOrgReadFor` in the same
    // sweep. Present in the registry, agentReachable: false either way.
    const result = await dispatch(
      "globalSearch.search",
      { args: { orgId: "org_A", query: "gig" } },
      auth(),
      "req_1",
    );
    expect(result.status).toBe(404);
    expect((result.body as { error: { code: string } }).error.code).toBe("UNKNOWN_OPERATION");
  });

  test("missing bearer token is a 401 MISSING_CREDENTIALS, before any registry lookup", async () => {
    const result = await dispatch("assets.list", { args: {} }, null, "req_1");
    expect(result.status).toBe(401);
    expect((result.body as { error: { code: string } }).error.code).toBe("MISSING_CREDENTIALS");
    expect(authenticateAgentRequest).not.toHaveBeenCalled();
  });
});

describe("dispatch — reads", () => {
  test("spends one agentRead token, then queries with the caller's agent client", async () => {
    mockClient.query.mockResolvedValueOnce([{ id: "a1" }]);
    const result = await dispatch("assets.list", { args: { orgId: "org_A" } }, auth(), "req_2");

    expect(spendAgentReadLimit).toHaveBeenCalledWith("key_1");
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(200);
    expect((result.body as { data: unknown }).data).toEqual([{ id: "a1" }]);
  });

  test("orgId is injected from the key even if the body names a different org", async () => {
    mockClient.query.mockResolvedValueOnce([]);
    await dispatch("assets.list", { args: { orgId: "org_B_someone_elses" } }, auth(), "req_3");

    const [, calledArgs] = mockClient.query.mock.calls[0];
    expect(calledArgs).toMatchObject({ orgId: "org_A" });
  });

  test("a rate-limit rejection propagates as the mapped error, not a 500", async () => {
    const { ConvexError } = await import("convex/values");
    spendAgentReadLimit.mockRejectedValueOnce(new ConvexError({ kind: "RateLimited", retryAfter: 5000 }));
    const result = await dispatch("assets.list", { args: { orgId: "org_A" } }, auth(), "req_4");
    expect(result.status).toBe(429);
    expect(mockClient.query).not.toHaveBeenCalled();
  });
});

describe("dispatch — writes require idempotency", () => {
  test("a mutation without an idempotencyKey is rejected before touching Convex", async () => {
    const result = await dispatch("assetWrites.updateNative", { args: { id: "a1", orgId: "org_A", set: {} } }, auth(), "req_5");
    expect(result.status).toBe(400);
    expect((result.body as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
    expect(idempotencyClient.mutation).not.toHaveBeenCalled();
    expect(mockClient.mutation).not.toHaveBeenCalled();
  });

  test("a claimed write runs once, completes the ledger, and returns 201", async () => {
    idempotencyClient.mutation
      .mockResolvedValueOnce({ status: "CLAIMED" }) // claim
      .mockResolvedValueOnce(null); // complete
    mockClient.mutation.mockResolvedValueOnce({ id: "a1" });

    const result = await dispatch(
      "assetWrites.updateNative",
      { args: { id: "a1", orgId: "org_A", set: { notes: "hi" } }, idempotencyKey: "idem-key-12345" },
      auth(),
      "req_6",
    );

    expect(result.status).toBe(201);
    expect(mockClient.mutation).toHaveBeenCalledTimes(1);
    // Second idempotency call is `complete`.
    expect(idempotencyClient.mutation.mock.calls[1][1]).toMatchObject({ result: { id: "a1" } });
  });

  test("a replayed idempotency key returns the stored result WITHOUT calling Convex again", async () => {
    idempotencyClient.mutation.mockResolvedValueOnce({ status: "REPLAYED", result: { id: "a1", already: true } });

    const result = await dispatch(
      "assetWrites.updateNative",
      { args: { id: "a1", orgId: "org_A", set: {} }, idempotencyKey: "idem-key-12345" },
      auth(),
      "req_7",
    );

    expect(result.status).toBe(200);
    expect((result.body as { data: unknown; replayed: boolean }).replayed).toBe(true);
    expect(mockClient.mutation).not.toHaveBeenCalled();
  });

  test("a failed write releases its idempotency claim instead of leaving it PENDING forever", async () => {
    idempotencyClient.mutation
      .mockResolvedValueOnce({ status: "CLAIMED" }) // claim
      .mockResolvedValueOnce(undefined); // release
    mockClient.mutation.mockRejectedValueOnce(new Error("boom"));

    const result = await dispatch(
      "assetWrites.updateNative",
      { args: { id: "a1", orgId: "org_A", set: {} }, idempotencyKey: "idem-key-12345" },
      auth(),
      "req_8",
    );

    expect(result.status).toBe(500);
    // The second ledger call is `release`, not `complete` — it carries no `result`.
    expect(getFunctionName(idempotencyClient.mutation.mock.calls[1][0])).toBe("apiIdempotency:release");
    expect(idempotencyClient.mutation.mock.calls[1][1]).not.toHaveProperty("result");
  });

  test("actor is always the verified key subject, never whatever the caller sent", async () => {
    idempotencyClient.mutation.mockResolvedValueOnce({ status: "CLAIMED" }).mockResolvedValueOnce(null);
    mockClient.mutation.mockResolvedValueOnce({ id: "a1" });

    await dispatch(
      "assetWrites.updateNative",
      {
        args: { id: "a1", orgId: "org_A", set: {}, actor: { userId: "attacker", userName: "Evil" } },
        idempotencyKey: "idem-key-12345",
      },
      auth(),
      "req_9",
    );

    const [, calledArgs] = mockClient.mutation.mock.calls[0];
    expect(calledArgs.actor).toEqual({ userId: "user_1", userName: "Ada" });
  });
});

describe("dispatch — request logging happens on every path", () => {
  test("logs a successful read", async () => {
    mockClient.query.mockResolvedValueOnce([]);
    await dispatch("assets.list", { args: { orgId: "org_A" } }, auth(), "req_10");
    expect(logApiRequest).toHaveBeenCalledWith(expect.objectContaining({ status: "success", operation: "assets.list", kind: "query" }));
  });

  test("logs a 404 for an unknown operation too", async () => {
    await dispatch("nope.nope", { args: {} }, auth(), "req_11");
    expect(logApiRequest).toHaveBeenCalledWith(expect.objectContaining({ status: "error", errorCode: "UNKNOWN_OPERATION" }));
  });
});

describe("dispatch — confirmation gate (Phase 4, #1000)", () => {
  // assetWrites.deleteNative is classified `danger: "high"` (delete/archive) in
  // its module's agentOps export.
  test("a high-danger write without confirm:true is CONFIRMATION_REQUIRED, and Convex is never called", async () => {
    const result = await dispatch(
      "assetWrites.deleteNative",
      { args: { id: "a1", orgId: "org_A" }, idempotencyKey: "idem-key-12345" },
      auth(),
      "req_12",
    );
    expect(result.status).toBe(409);
    const body = result.body as unknown as { error: { code: string; details: { danger: string; summary: string } } };
    expect(body.error.code).toBe("CONFIRMATION_REQUIRED");
    expect(body.error.details.danger).toBe("high");
    expect(body.error.details.summary).toMatch(/confirm: true/);
    expect(mockClient.mutation).not.toHaveBeenCalled();
    expect(idempotencyClient.mutation).not.toHaveBeenCalled();
  });

  test("the identical call WITH confirm:true proceeds", async () => {
    idempotencyClient.mutation.mockResolvedValueOnce({ status: "CLAIMED" }).mockResolvedValueOnce(null);
    mockClient.mutation.mockResolvedValueOnce({ id: "a1" });

    const result = await dispatch(
      "assetWrites.deleteNative",
      { args: { id: "a1", orgId: "org_A" }, idempotencyKey: "idem-key-12345", confirm: true },
      auth(),
      "req_13",
    );
    expect(result.status).toBe(201);
    expect(mockClient.mutation).toHaveBeenCalledTimes(1);
  });

  test("a medium-danger write (assetWrites.updateNative) needs no confirm at all", async () => {
    idempotencyClient.mutation.mockResolvedValueOnce({ status: "CLAIMED" }).mockResolvedValueOnce(null);
    mockClient.mutation.mockResolvedValueOnce({ id: "a1" });

    const result = await dispatch(
      "assetWrites.updateNative",
      { args: { id: "a1", orgId: "org_A", set: {} }, idempotencyKey: "idem-key-12345" },
      auth(),
      "req_14",
    );
    expect(result.status).toBe(201);
  });

  // lineItemWrites.patchNative is classified `medium`, but `justification` itself
  // carries `danger: "high"` in the privileged-arg policy table — supplying one
  // escalates THIS call to confirm-required without reclassifying the operation.
  test("a medium-danger op escalates to confirm-required when it supplies a privileged arg whose OWN policy danger is high", async () => {
    const result = await dispatch(
      "lineItemWrites.patchNative",
      {
        args: { id: "li1", orgId: "org_A", set: {}, clear: [], justification: "Client asked for a change on site." },
        idempotencyKey: "idem-key-12345",
      },
      auth(),
      "req_15",
    );
    expect(result.status).toBe(409);
    const body = result.body as unknown as { error: { code: string; details: { summary: string } } };
    expect(body.error.code).toBe("CONFIRMATION_REQUIRED");
    expect(body.error.details.summary).toMatch(/justification/);
    expect(mockClient.mutation).not.toHaveBeenCalled();
  });

  test("the same op with an EMPTY justification does not escalate (nothing is actually being invoked)", async () => {
    idempotencyClient.mutation.mockResolvedValueOnce({ status: "CLAIMED" }).mockResolvedValueOnce(null);
    mockClient.mutation.mockResolvedValueOnce({ id: "li1" });

    const result = await dispatch(
      "lineItemWrites.patchNative",
      { args: { id: "li1", orgId: "org_A", set: {}, clear: [], justification: "" }, idempotencyKey: "idem-key-12345" },
      auth(),
      "req_16",
    );
    expect(result.status).toBe(201);
  });
});
