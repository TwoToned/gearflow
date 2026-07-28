/**
 * Real-protocol integration test for the MCP surface (Phase 3, #999).
 *
 * `build-server.test.ts` unit-tests `routeToolCall` directly (bypassing the
 * MCP SDK's `Server` class); `route.test.ts` unit-tests the Next.js route
 * with `buildMcpServer` mocked away (bypassing the tool router). Neither
 * proves the actual wire protocol works — that `buildMcpServer`'s `Server`
 * correctly answers `initialize`/`tools/list`/`tools/call`/`resources/*`/
 * `prompts/*` the way a real MCP client would drive it.
 *
 * This file closes that gap using the SDK's own `Client` connected to the
 * REAL (unmocked) `buildMcpServer()` output over `InMemoryTransport` — full
 * JSON-RPC framing and capability negotiation, no HTTP layer needed. Only the
 * deepest boundary is mocked (`dispatch`/`getWhoamiData`/
 * `listOperationsPage`/`describeOperation` — the same boundary
 * dispatcher.test.ts and build-server.test.ts already mock), so this is the
 * closest thing to "connect a real client and ask it something" available
 * without a live Convex deployment (this session has neither `.env` nor
 * `CONVEX_DEPLOY_KEY` — see #999 PR notes).
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const dispatchMock = vi.fn();
vi.mock("../dispatcher", () => ({ dispatch: (...args: unknown[]) => dispatchMock(...args) }));

const getWhoamiDataMock = vi.fn();
vi.mock("../whoami", () => ({ getWhoamiData: (...args: unknown[]) => getWhoamiDataMock(...args) }));

const listOperationsPageMock = vi.fn();
const describeOperationMock = vi.fn();
vi.mock("../operations-listing", () => ({
  listOperationsPage: (...args: unknown[]) => listOperationsPageMock(...args),
  describeOperation: (...args: unknown[]) => describeOperationMock(...args),
}));

const { buildMcpServer } = await import("./build-server");
const { MCP_NAMESPACE, MCP_TOOLS } = await import("../mcp-manifest.generated");

const mockAgent = {
  key: { id: "key_1", organizationId: "org_A", actingUserId: "user_1" },
  actor: { organizationId: "org_A", userId: "user_1", userName: "Ada", actorType: "apiKey" as const, apiKeyId: "key_1", scopes: ["*"] },
  client: { query: vi.fn(), mutation: vi.fn() },
};

let client: Client;

beforeEach(async () => {
  vi.clearAllMocks();
  const server = buildMcpServer({ agent: mockAgent as never, authorizationHeader: "Bearer gf_live_test", requestId: "req_1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
});

describe("MCP protocol — tools/list", () => {
  test("advertises every manifest tool, namespaced, with a non-empty description", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(MCP_TOOLS.length);
    for (const tool of tools) {
      expect(tool.name.startsWith(`${MCP_NAMESPACE}.`)).toBe(true);
      expect(tool.description?.length).toBeGreaterThan(0);
    }
  });
});

describe("MCP protocol — tools/call", () => {
  test("whoami round-trips through the real Server → routeToolCall → getWhoamiData path", async () => {
    getWhoamiDataMock.mockResolvedValueOnce({ organizationId: "org_A", role: "owner" });
    const result = await client.callTool({ name: `${MCP_NAMESPACE}.whoami`, arguments: {} });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ data: { organizationId: "org_A", role: "owner" } });
  });

  test("a curated tool round-trips through to dispatch() with the real JSON-RPC framing intact", async () => {
    dispatchMock.mockResolvedValueOnce({ status: 200, body: { data: { id: "asset_1", name: "Camera" }, requestId: "req_1" } });
    const result = await client.callTool({ name: `${MCP_NAMESPACE}.get_asset`, arguments: { id: "asset_1" } });
    expect(dispatchMock).toHaveBeenCalledWith("assets.getById", { args: { id: "asset_1" }, idempotencyKey: undefined }, "Bearer gf_live_test", "req_1");
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ data: { id: "asset_1" } });
  });

  test("call_operation reaches dispatch() with the operation name preserved across the wire", async () => {
    dispatchMock.mockResolvedValueOnce({ status: 200, body: { data: [], requestId: "req_1" } });
    await client.callTool({
      name: `${MCP_NAMESPACE}.call_operation`,
      arguments: { operation: "crewMembers.list", args: {}, idempotencyKey: undefined },
    });
    expect(dispatchMock).toHaveBeenCalledWith("crewMembers.list", { args: {}, idempotencyKey: undefined }, "Bearer gf_live_test", "req_1");
  });

  test("an unknown tool name comes back as a tool-level error over the real protocol, not a JSON-RPC fault", async () => {
    const result = await client.callTool({ name: `${MCP_NAMESPACE}.not_a_real_tool`, arguments: {} });
    expect(result.isError).toBe(true);
  });
});

describe("MCP protocol — resources", () => {
  test("lists and reads llms.txt", async () => {
    const { resources } = await client.listResources();
    expect(resources.some((r) => r.uri === "rvlt-flow://llms.txt")).toBe(true);

    const { contents } = await client.readResource({ uri: "rvlt-flow://llms.txt" });
    const [first] = contents;
    expect(first.mimeType).toBe("text/plain");
    expect(typeof ("text" in first ? first.text : undefined)).toBe("string");
  });
});

describe("MCP protocol — prompts", () => {
  test("lists the 3 recurring-workflow prompts and renders one with its arguments", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["overbooking_triage", "prep_sheet_review", "weekly_availability_sweep"]);

    const { messages } = await client.getPrompt({ name: "prep_sheet_review", arguments: { projectId: "proj_1" } });
    const text = messages[0]?.content;
    expect(text && "text" in text ? text.text : "").toContain("proj_1");
  });
});
