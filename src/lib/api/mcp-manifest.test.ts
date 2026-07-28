/**
 * Shape invariants for the generated MCP tool manifest (Phase 3, #999, design
 * §7/§12) — the in-memory counterpart to `pnpm run api:mcp:check`'s
 * regenerate-and-diff staleness gate (wired into CI, ci.yml). This file
 * checks properties that survive even a *correct* regeneration: every
 * curated tool's `operation` really exists and is agent-reachable, tool
 * names are unique and namespaced, and mutation tools carry the
 * `idempotencyKey` requirement `dispatch()` itself enforces
 * (dispatcher.ts's `parseEnvelope`) — so the published schema can never
 * promise something the dispatcher would reject.
 */
import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { API_REGISTRY_BY_OPERATION } from "./registry.generated";
import { MCP_NAMESPACE, MCP_TOOLS, MCP_CURATED_TOOLS, MCP_DISCOVERY_TOOLS, MCP_TOOLS_BY_NAME } from "./mcp-manifest.generated";
import { CURATED_TOOL_DEFS } from "./mcp/curated-tool-defs";

describe("MCP manifest — staleness gate (subprocess, mirrors CI)", () => {
  test("`pnpm run api:mcp:check` passes against the committed file", () => {
    expect(() =>
      execFileSync("pnpm", ["exec", "tsx", "scripts/generate-mcp-manifest.mts", "--check"], {
        cwd: process.cwd(),
        stdio: "pipe",
      }),
    ).not.toThrow();
  }, 60_000);
});

describe("MCP manifest — shape invariants", () => {
  test("one manifest entry per curated-tool-defs.ts row, plus exactly 3 discovery tools", () => {
    expect(MCP_CURATED_TOOLS.length).toBe(CURATED_TOOL_DEFS.length);
    expect(MCP_DISCOVERY_TOOLS.map((t) => t.name)).toEqual([
      `${MCP_NAMESPACE}.list_operations`,
      `${MCP_NAMESPACE}.describe_operation`,
      `${MCP_NAMESPACE}.call_operation`,
    ]);
  });

  test("every tool name is namespaced and unique", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.startsWith(`${MCP_NAMESPACE}.`)).toBe(true);
    expect(MCP_TOOLS_BY_NAME.size).toBe(MCP_TOOLS.length);
  });

  test("every curated tool with an operation maps to an agent-reachable registry operation", () => {
    for (const tool of MCP_CURATED_TOOLS) {
      if (tool.operation === null) continue;
      const op = API_REGISTRY_BY_OPERATION.get(tool.operation);
      expect(op, `"${tool.name}" -> "${tool.operation}" must exist in the registry`).toBeDefined();
      expect(op?.agentReachable, `"${tool.name}" -> "${tool.operation}" must be agent-reachable`).toBe(true);
    }
  });

  test("a curated tool wrapping a mutation requires idempotencyKey in its input schema", () => {
    for (const tool of MCP_CURATED_TOOLS) {
      if (tool.operation === null) continue;
      const op = API_REGISTRY_BY_OPERATION.get(tool.operation)!;
      const schema = tool.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
      if (op.kind === "mutation") {
        expect(schema.required ?? []).toContain("idempotencyKey");
        expect(schema.properties).toHaveProperty("idempotencyKey");
      } else {
        expect(schema.properties).not.toHaveProperty("idempotencyKey");
      }
    }
  });

  test("`call_operation` is the one tool marked tracks-app; everything else is stable (design §13)", () => {
    for (const tool of MCP_TOOLS) {
      const expected = tool.name === `${MCP_NAMESPACE}.call_operation` ? "tracks-app" : "stable";
      expect(tool.stability, tool.name).toBe(expected);
    }
  });

  test("whoami is the only curated tool with a null operation", () => {
    const nullOps = MCP_CURATED_TOOLS.filter((t) => t.operation === null).map((t) => t.name);
    expect(nullOps).toEqual([`${MCP_NAMESPACE}.whoami`]);
  });
});
