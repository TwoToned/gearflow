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
// invokeOperation would load real server actions; stub just that. Discovery
// (list/describe) stays real so the tests exercise the actual registry.
const invokeOperation = vi.fn();
vi.mock("@/lib/api/dispatch", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/dispatch")>("@/lib/api/dispatch");
  return { ...actual, invokeOperation: (...a: unknown[]) => invokeOperation(...a) };
});

import { handleMcpMessage, MCP_TOOLS, type JsonRpcRequest } from "@/lib/api/mcp";
import { ApiKeyAuthError } from "@/lib/api-key";
import { CURATED_TOOLS } from "@/lib/api/mcp-tools";

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
      serverInfo: { name: "gearflow", version: "v1" },
    });
  });

  it("lists the capability tools with rich descriptions", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, null);
    const tools = (res!.result as { tools: typeof MCP_TOOLS }).tools;
    const names = tools.map((t) => t.name);

    // The meta tools + the dynamic-dispatch trio that reaches the full registry.
    expect(names).toEqual(
      expect.arrayContaining([
        "whoami",
        "reserve_items",
        "list_operations",
        "describe_operation",
        "call_operation",
      ]),
    );
    // The read tools an agent needs to answer "show me the projects" — the gap
    // that made an agent's first attempt at this fail.
    expect(names).toEqual(expect.arrayContaining(["list_projects", "get_project", "search_assets"]));

    // reserve_items description names its prerequisite + required scope (agent DX).
    const reserve = tools.find((t) => t.name === "reserve_items")!;
    expect(reserve.description).toMatch(/projectId/);
    expect(reserve.description).toMatch(/project:manage_line_items/);
  });

  it("advertises tools.listChanged so a stale tool list is detectable", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }, null);
    expect((res!.result as { capabilities: { tools: { listChanged?: boolean } } }).capabilities.tools)
      .toEqual({ listChanged: true });
  });

  it("gives curated write tools the REAL generated schema, not a prose placeholder", () => {
    // Hand-written descriptions drift the moment the Zod validator changes. An agent
    // must see the exact fields, enums and required-ness the action enforces.
    const createClient = CURATED_TOOLS.find((t) => t.name === "create_client")!;
    const client = createClient.inputSchema.properties.client as {
      type: string;
      required: string[];
      properties: Record<string, { enum?: string[] }>;
      description?: string;
      $schema?: string;
    };
    expect(client.type).toBe("object");
    expect(client.required).toEqual(["name"]);
    expect(Object.keys(client.properties)).toContain("contactEmail");
    expect(client.properties.type.enum).toContain("PRODUCTION_COMPANY");
    // The human description survives the splice.
    expect(client.description).toBeTruthy();
    // Subschemas are not standalone documents.
    expect(client.$schema).toBeUndefined();
  });

  it("leaves inline-typed params alone (their fields are already in the type text)", () => {
    const listProjects = CURATED_TOOLS.find((t) => t.name === "list_projects")!;
    const filters = listProjects.inputSchema.properties.filters as { properties?: unknown };
    expect(filters.properties).toBeUndefined();
  });

  it("exposes a batch availability tool so an agent needn't loop check_availability", () => {
    const batch = CURATED_TOOLS.find((t) => t.name === "check_availability_batch")!;
    expect(batch.operation).toBe("line-items.checkAvailabilityBatch");
    const modelIds = batch.inputSchema.properties.modelIds as { maxItems: number };
    expect(modelIds.maxItems).toBe(100);
    expect(batch.inputSchema.required).toEqual(["modelIds"]);
  });

  it("keeps the tool list small enough for an agent to reason over", () => {
    // The whole point of the curated + dynamic-dispatch split. If this trips,
    // move the new tool behind call_operation rather than raising the bound.
    expect(MCP_TOOLS.length).toBeLessThanOrEqual(40);
  });

  it("every curated tool declares its required scope in the description", () => {
    for (const tool of CURATED_TOOLS) {
      expect(tool.description, `${tool.name} must name its scope`).toMatch(/Required scope: \w+:/);
    }
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
      "Bearer gf_live_x",
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
      "Bearer gf_live_x",
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

/** Parse a successful tools/call result's JSON payload. */
async function callTool(name: string, args: Record<string, unknown> = {}) {
  const res = await handleMcpMessage(
    { jsonrpc: "2.0", id: 42, method: "tools/call", params: { name, arguments: args } },
    "Bearer gf_live_x",
  );
  const result = res!.result as { isError?: boolean; content: { text: string }[] };
  return { isError: Boolean(result.isError), payload: JSON.parse(result.content[0].text) };
}

describe("curated tools", () => {
  beforeEach(() => authenticateApiRequest.mockResolvedValue(actor));

  it("list_projects runs the projects.getProjects operation", async () => {
    invokeOperation.mockResolvedValue({
      operation: "projects.getProjects",
      kind: "read",
      replayed: false,
      result: [{ id: "p1", name: "Gig" }],
    });
    const { payload } = await callTool("list_projects", { filters: { search: "Gig" } });

    expect(invokeOperation).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        operation: "projects.getProjects",
        // `filters` is renamed onto the action's actual `params` argument.
        arguments: { params: { search: "Gig" } },
      }),
    );
    // The agent gets the projects, not the dispatcher's envelope.
    expect(payload).toEqual([{ id: "p1", name: "Gig" }]);
  });

  it("strips confirm/idempotencyKey from a curated tool's operation arguments", async () => {
    // An agent that follows call_operation's docs and passes confirm would
    // otherwise trip the dispatcher's unknown-argument check.
    invokeOperation.mockResolvedValue({ operation: "clients.createClient", kind: "write", replayed: false, result: { id: "c1" } });
    await callTool("create_client", {
      client: { name: "Acme" },
      confirm: true,
      idempotencyKey: "idem-1",
    });
    expect(invokeOperation).toHaveBeenCalledWith(actor, {
      operation: "clients.createClient",
      arguments: { data: { name: "Acme" } },
      confirm: true,
      idempotencyKey: "idem-1",
    });
  });

  it("get_project renames projectId onto the action's `id` parameter", async () => {
    invokeOperation.mockResolvedValue({ operation: "projects.getProject", kind: "read", replayed: false, result: { id: "p1" } });
    await callTool("get_project", { projectId: "p1" });
    expect(invokeOperation).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ arguments: { id: "p1" } }),
    );
  });
});

describe("dynamic dispatch tools", () => {
  beforeEach(() => authenticateApiRequest.mockResolvedValue(actor));

  it("list_operations returns only what the key is scoped for", async () => {
    const { payload } = await callTool("list_operations", { search: "project" });
    // actor holds only project:manage_line_items
    const scopes: string[] = payload.operations.map((o: { scope: string }) => o.scope);
    expect(scopes.length).toBeGreaterThan(0);
    expect(new Set(scopes)).toEqual(new Set(["project:manage_line_items"]));
  });

  it("list_operations can filter to reads", async () => {
    const wide = { ...actor, scopes: ["*"] };
    authenticateApiRequest.mockResolvedValue(wide);
    const { payload } = await callTool("list_operations", { kind: "read", limit: 5 });
    expect(payload.operations.every((o: { kind: string }) => o.kind === "read")).toBe(true);
    expect(payload.total).toBeGreaterThan(100);
  });

  it("describe_operation returns the real call signature from the registry", async () => {
    const { payload } = await callTool("describe_operation", { operation: "projects.getProject" });
    expect(payload).toMatchObject({
      name: "projects.getProject",
      kind: "read",
      scope: "project:read",
      parameters: [{ name: "id", required: true }],
    });
  });

  it("describe_operation surfaces the confirmation requirement for a destructive op", async () => {
    const { payload } = await callTool("describe_operation", { operation: "projects.deleteProject" });
    expect(payload).toMatchObject({ dangerous: true, requiresConfirmation: true });
  });

  it("describe_operation errors structurally on an unknown operation", async () => {
    const { isError, payload } = await callTool("describe_operation", { operation: "nope.nothing" });
    expect(isError).toBe(true);
    expect(payload.error.code).toBe("NOT_FOUND");
  });

  it("call_operation forwards confirm + idempotencyKey to the dispatcher", async () => {
    invokeOperation.mockResolvedValue({ operation: "projects.archiveProject", kind: "write", replayed: false, result: { ok: true } });
    await callTool("call_operation", {
      operation: "projects.archiveProject",
      arguments: { id: "p1" },
      confirm: true,
      idempotencyKey: "idem-1",
    });
    expect(invokeOperation).toHaveBeenCalledWith(actor, {
      operation: "projects.archiveProject",
      arguments: { id: "p1" },
      confirm: true,
      idempotencyKey: "idem-1",
    });
  });

  it("call_operation surfaces CONFIRMATION_REQUIRED as a structured isError result", async () => {
    const { ApiError } = await import("@/lib/api/errors");
    invokeOperation.mockRejectedValue(
      new ApiError("CONFIRMATION_REQUIRED", "needs confirm", { details: { dangerous: true } }),
    );
    const { isError, payload } = await callTool("call_operation", {
      operation: "projects.deleteProject",
      arguments: { id: "p1" },
    });
    expect(isError).toBe(true);
    expect(payload.error.code).toBe("CONFIRMATION_REQUIRED");
    expect(payload.error.documentation_url).toBeTruthy();
  });
});
