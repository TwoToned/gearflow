import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActorContext } from "../actor-context";

const authenticateApiRequest = vi.fn();
vi.mock("@/lib/api/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/http")>("@/lib/api/http");
  return { ...actual, authenticateApiRequest: (...a: unknown[]) => authenticateApiRequest(...a) };
});
const reserveItems = vi.fn();
vi.mock("@/lib/api/reserve-items", () => ({ reserveItems: (...a: unknown[]) => reserveItems(...a) }));
// reserve-port pulls in server actions + prisma; stub it — the handler only passes it through.
vi.mock("@/lib/api/reserve-port", () => ({ convexReservationPort: {} }));
vi.mock("@/lib/api-key", () => ({ getApiKeyActorContext: vi.fn(), ApiKeyAuthError: class extends Error { code = "INVALID_KEY"; } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { handleMcpMessage, MCP_TOOLS, type JsonRpcRequest } from "@/lib/api/mcp";
import { ApiKeyAuthError } from "@/lib/api-key";

const actor: ActorContext = {
  organizationId: "org_1",
  userId: "user_1",
  userName: "Ada",
  actorType: "apiKey",
  apiKeyId: "key_1",
  scopes: ["project:manage_line_items"],
};

beforeEach(() => vi.clearAllMocks());

describe("handleMcpMessage — protocol", () => {
  it("responds to initialize with protocol version + server info", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }, "Bearer x");
    expect(res!.result).toMatchObject({
      protocolVersion: expect.any(String),
      serverInfo: { name: "rvlt-flow", version: "v1" },
    });
  });

  it("lists the capability tools with rich descriptions", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, null);
    const tools = (res!.result as { tools: typeof MCP_TOOLS }).tools;
    expect(tools.map((t) => t.name)).toEqual(["whoami", "reserve_items"]);
    // reserve_items description names its prerequisite + required scope (agent DX).
    const reserve = tools.find((t) => t.name === "reserve_items")!;
    expect(reserve.description).toMatch(/projectId/);
    expect(reserve.description).toMatch(/project:manage_line_items/);
  });

  it("returns null (no body) for notifications", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" } as JsonRpcRequest,
      null,
    );
    expect(res).toBeNull();
  });

  it("returns -32601 for an unknown method", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 9, method: "does/not/exist" }, null);
    expect(res!.error!.code).toBe(-32601);
  });
});

describe("handleMcpMessage — tools/call", () => {
  it("dispatches whoami to the authenticated identity", async () => {
    authenticateApiRequest.mockResolvedValue(actor);
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whoami", arguments: {} } },
      "Bearer rvlt_live_x",
    );
    const content = (res!.result as { content: { text: string }[] }).content[0].text;
    expect(JSON.parse(content)).toMatchObject({ organizationId: "org_1", actorType: "apiKey" });
  });

  it("dispatches reserve_items to the verb with parsed args", async () => {
    authenticateApiRequest.mockResolvedValue(actor);
    reserveItems.mockResolvedValue({ committed: false, preview: [] });
    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "reserve_items",
          arguments: { projectId: "p1", items: [{ modelId: "m1", quantity: 2 }], confirm: false },
        },
      },
      "Bearer rvlt_live_x",
    );
    expect(reserveItems).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ projectId: "p1", confirm: false }),
      expect.anything(),
    );
  });

  it("surfaces an auth failure as a structured isError result, not a transport error", async () => {
    authenticateApiRequest.mockRejectedValue(new ApiKeyAuthError("INVALID_KEY", "bad key"));
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "whoami", arguments: {} } },
      null,
    );
    const result = res!.result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error.code).toBe("INVALID_KEY");
  });

  it("returns an isError result for an unknown tool", async () => {
    authenticateApiRequest.mockResolvedValue(actor);
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope", arguments: {} } },
      "Bearer x",
    );
    expect((res!.result as { isError: boolean }).isError).toBe(true);
  });
});
