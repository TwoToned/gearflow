/**
 * `/api/v1/mcp` route (Phase 3, #999). What's tested here is exactly what
 * this route owns before handing off to the MCP SDK's transport: bearer auth
 * (missing/invalid → the same envelope shape every other `/api/v1` route
 * returns), building the per-request `Server` with the resolved agent
 * context, and stamping the `X-RVLT-Flow-API-Version` header onto whatever
 * the transport returns. The MCP wire protocol itself (JSON-RPC framing,
 * SSE/JSON response mode) is the SDK's own tested code — mocked at the
 * boundary here, same posture as dispatcher.test.ts mocking `agent-auth`.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const mockAgent = {
  key: { id: "key_1", organizationId: "org_A", actingUserId: "user_1" },
  actor: { organizationId: "org_A", userId: "user_1", userName: "Ada", actorType: "apiKey" as const, apiKeyId: "key_1", scopes: ["*"] },
  client: { query: vi.fn(), mutation: vi.fn() },
};

const authenticateAgentRequest = vi.fn(async () => mockAgent);
vi.mock("@/lib/api/agent-auth", () => ({
  parseBearerToken: (header: string | null) => {
    const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
    return m?.[1] ?? null;
  },
  authenticateAgentRequest: (...args: unknown[]) => authenticateAgentRequest(...(args as [])),
}));

const serverConnect = vi.fn(async () => {});
const buildMcpServer = vi.fn(() => ({ connect: serverConnect }));
vi.mock("@/lib/api/mcp/build-server", () => ({
  buildMcpServer: (...args: unknown[]) => buildMcpServer(...(args as [])),
}));

const transportHandleRequest = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), { status: 200 }));
class MockTransport {
  handleRequest = transportHandleRequest;
}
vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => ({
  WebStandardStreamableHTTPServerTransport: MockTransport,
}));

const { POST } = await import("./route");

function req(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/v1/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateAgentRequest.mockResolvedValue(mockAgent);
  serverConnect.mockResolvedValue(undefined);
});

describe("POST /api/v1/mcp — auth gate", () => {
  test("401 MISSING_CREDENTIALS with no bearer token — never touches the MCP transport", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_CREDENTIALS");
    expect(buildMcpServer).not.toHaveBeenCalled();
    expect(res.headers.get("X-RVLT-Flow-API-Version")).toBe("v1");
  });

  test("propagates the auth error envelope/status for an invalid key", async () => {
    authenticateAgentRequest.mockRejectedValueOnce(Object.assign(new Error("bad key"), { code: "INVALID_KEY" }));
    const res = await POST(req({ authorization: "Bearer gf_live_bad" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_KEY");
    expect(buildMcpServer).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/mcp — authenticated request", () => {
  test("builds the server with the resolved agent + raw authorization header, then delegates to the transport", async () => {
    const res = await POST(req({ authorization: "Bearer gf_live_good" }));

    expect(buildMcpServer).toHaveBeenCalledWith({
      agent: mockAgent,
      authorizationHeader: "Bearer gf_live_good",
      requestId: null,
    });
    expect(transportHandleRequest).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RVLT-Flow-API-Version")).toBe("v1");
  });

  test("threads x-request-id through to buildMcpServer", async () => {
    await POST(req({ authorization: "Bearer gf_live_good", "x-request-id": "req_abc" }));
    expect(buildMcpServer).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req_abc" }));
  });
});
