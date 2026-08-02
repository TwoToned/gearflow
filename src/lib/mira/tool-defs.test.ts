import { describe, test, expect, vi } from "vitest";

vi.mock("@/lib/api/mcp/curated-tool-defs", () => ({
  CURATED_TOOL_DEFS: [
    { name: "whoami", title: "Whoami", operation: null, summary: "who" },
    { name: "search_assets", title: "Search assets", operation: "assets.list", summary: "search" },
    { name: "create_project", title: "Create project", operation: "projectWrites.createNative", summary: "create" },
    { name: "dispatch_gear", title: "Dispatch gear", operation: "warehouseWrites.checkOutItems", summary: "dispatch" },
    { name: "delete_thing", title: "Delete thing", operation: "thingWrites.deleteNative", summary: "delete" },
  ],
}));

vi.mock("@/lib/api/mcp-manifest.generated", () => {
  const entry = (name: string, extra: { operation?: string } = {}): [string, Record<string, unknown>] => [
    `rvlt_flow.v1.${name}`,
    {
      name: `rvlt_flow.v1.${name}`,
      title: name,
      description: `${name} description`,
      inputSchema: { type: "object", properties: { idempotencyKey: { type: "string" }, foo: { type: "string" } }, required: ["idempotencyKey"], additionalProperties: false },
      stability: "stable",
      operation: extra.operation ?? null,
    },
  ];
  return {
    MCP_NAMESPACE: "rvlt_flow.v1",
    MCP_TOOLS_BY_NAME: new Map([
      entry("whoami"),
      entry("search_assets", { operation: "assets.list" }),
      entry("create_project", { operation: "projectWrites.createNative" }),
      entry("dispatch_gear", { operation: "warehouseWrites.checkOutItems" }),
      entry("delete_thing", { operation: "thingWrites.deleteNative" }),
    ]),
  };
});

vi.mock("@/lib/api/registry.generated", () => ({
  API_REGISTRY_BY_OPERATION: new Map([
    ["assets.list", { kind: "query", danger: null, scopePairs: [] }],
    ["projectWrites.createNative", { kind: "mutation", danger: "low", scopePairs: [{ resource: "project", action: "create" }] }],
    ["warehouseWrites.checkOutItems", { kind: "mutation", danger: "high", scopePairs: [{ resource: "warehouse", action: "check_out" }] }],
    ["thingWrites.deleteNative", { kind: "mutation", danger: "high", scopePairs: [{ resource: "thing", action: "delete" }] }],
  ]),
}));

const { buildMiraTools, findMiraTool } = await import("./tool-defs");

describe("buildMiraTools", () => {
  test("read-only mode: only queries and null-operation tools, writes excluded regardless of scopes", () => {
    const tools = buildMiraTools({ includeWrites: false, grantedScopes: new Set(["project:create", "warehouse:check_out", "thing:delete"]) });
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["whoami", "search_assets"]));
    expect(names).not.toContain("create_project");
    expect(names).not.toContain("dispatch_gear");
    expect(names).not.toContain("delete_thing");
  });

  test("write mode: a mutation is offered only when the granted scopes cover every required scope pair", () => {
    const tools = buildMiraTools({ includeWrites: true, grantedScopes: new Set(["project:create"]) });
    const names = tools.map((t) => t.name);
    expect(names).toContain("create_project"); // scope covered
    expect(names).not.toContain("dispatch_gear"); // warehouse:check_out not granted
    expect(names).not.toContain("delete_thing"); // thing:delete not granted
  });

  test("write mode with full scope coverage offers the mutation", () => {
    const tools = buildMiraTools({ includeWrites: true, grantedScopes: new Set(["warehouse:check_out"]) });
    expect(tools.map((t) => t.name)).toContain("dispatch_gear");
  });

  test("idempotencyKey and confirm are never exposed in a tool's parameters", () => {
    const tools = buildMiraTools({ includeWrites: true, grantedScopes: new Set(["project:create"]) });
    const createProject = tools.find((t) => t.name === "create_project")!;
    expect(createProject.parameters.properties).not.toHaveProperty("idempotencyKey");
    expect(createProject.parameters.properties).not.toHaveProperty("confirm");
    expect((createProject.parameters.required as string[] | undefined) ?? []).not.toContain("idempotencyKey");
  });

  test("danger and isWrite are carried through from the registry", () => {
    const tools = buildMiraTools({ includeWrites: true, grantedScopes: new Set(["warehouse:check_out"]) });
    const dispatchGear = tools.find((t) => t.name === "dispatch_gear")!;
    expect(dispatchGear.isWrite).toBe(true);
    expect(dispatchGear.danger).toBe("high");
    const whoami = tools.find((t) => t.name === "whoami")!;
    expect(whoami.isWrite).toBe(false);
  });

  test("findMiraTool looks up by bare name", () => {
    const tools = buildMiraTools({ includeWrites: false, grantedScopes: new Set() });
    expect(findMiraTool(tools, "search_assets")?.operation).toBe("assets.list");
    expect(findMiraTool(tools, "nope")).toBeUndefined();
  });
});
