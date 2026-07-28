/**
 * MCP tool manifest generator (Phase 3, #999, design §12).
 *
 * Reads the ALREADY-generated `API_REGISTRY` (same precondition as
 * generate-api-docs.mts — CI's api:registry:check step precedes this one)
 * plus the hand-authored curated-tool identity table
 * (src/lib/api/mcp/curated-tool-defs.ts) and combines them into one
 * generated, committed manifest: `src/lib/api/mcp-manifest.generated.ts`.
 *
 * This is the fix for the previous build's "MCP tool-list staleness" finding
 * (design §7): the tool list, its argument schemas, and its descriptions are
 * a pure derivation of the registry, never hand-maintained, and `--check`
 * fails CI the moment they disagree. A curated tool whose target operation
 * disappears or loses agent-reachability fails generation loudly (see
 * `buildCuratedTools`) rather than silently publishing a broken tool.
 *
 * Usage:
 *   pnpm run api:mcp          # regenerate
 *   pnpm run api:mcp:check    # verify committed output is current (CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { API_REGISTRY_BY_OPERATION, type RegistryOperation } from "../src/lib/api/registry.generated.js";
import { argsObjectSchema, type JsonSchema } from "../src/lib/api/json-schema.js";
import { CURATED_TOOL_DEFS, type CuratedToolDef } from "../src/lib/api/mcp/curated-tool-defs.js";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "src/lib/api/mcp-manifest.generated.ts");

/** `rvlt_flow.v1.*` MCP tool namespace (design §13 versioning mechanics). */
export const MCP_NAMESPACE = "rvlt_flow.v1";

interface McpToolManifestEntry {
  /** Namespaced, e.g. "rvlt_flow.v1.search_assets". */
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** design §13 compatibility policy: curated tools + discovery are
   *  additive-only within /v1; `call_operation` tracks the app directly. */
  stability: "stable" | "tracks-app";
  /** The underlying registry operation this tool dispatches to, or null for
   *  a specially-handled tool (whoami, list_operations, describe_operation,
   *  call_operation — none of which is a single fixed operation). */
  operation: string | null;
}

const IDEMPOTENCY_KEY_SCHEMA: JsonSchema = {
  type: "string",
  minLength: 8,
  maxLength: 200,
  description: "Required for writes. A retry with the same key replays the first result instead of double-writing.",
};

function describeCurated(def: CuratedToolDef, op: RegistryOperation): string {
  const scope = op.scopePairs.length ? op.scopePairs.map((p) => `${p.resource}:${p.action}`).join(" or ") : "none";
  const parts = [def.summary];
  if (def.prerequisites) parts.push(`Prerequisites: ${def.prerequisites}`);
  if (def.transition) parts.push(`Transition: ${def.transition}.`);
  parts.push(`Scope required: ${scope}.`);
  parts.push(
    op.kind === "mutation"
      ? "Idempotent: pass `idempotencyKey` (>=8 chars) — a retry with the same key replays the first result instead of double-writing."
      : "Read-only; no idempotencyKey needed.",
  );
  parts.push(
    "Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call " +
      "`describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
  );
  return parts.join(" ");
}

function curatedInputSchema(op: RegistryOperation): JsonSchema {
  const schema = argsObjectSchema(op);
  if (op.kind !== "mutation") return schema;
  const properties = { ...(schema.properties as Record<string, JsonSchema>), idempotencyKey: IDEMPOTENCY_KEY_SCHEMA };
  const required = [...((schema.required as string[]) ?? []), "idempotencyKey"];
  return { ...schema, properties, required };
}

function buildCuratedTools(): McpToolManifestEntry[] {
  return CURATED_TOOL_DEFS.map((def) => {
    if (def.operation === null) {
      return {
        name: `${MCP_NAMESPACE}.${def.name}`,
        title: def.title,
        description: def.summary,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        stability: "stable" as const,
        operation: null,
      };
    }
    const op = API_REGISTRY_BY_OPERATION.get(def.operation);
    if (!op || !op.agentReachable) {
      throw new Error(
        `Curated MCP tool "${def.name}" maps to operation "${def.operation}", which is not agent-reachable in the ` +
          `registry. Fix src/lib/api/mcp/curated-tool-defs.ts or the operation's guard.`,
      );
    }
    return {
      name: `${MCP_NAMESPACE}.${def.name}`,
      title: def.title,
      description: describeCurated(def, op),
      inputSchema: curatedInputSchema(op),
      stability: "stable" as const,
      operation: op.operation,
    };
  });
}

function buildDiscoveryTools(): McpToolManifestEntry[] {
  return [
    {
      name: `${MCP_NAMESPACE}.list_operations`,
      title: "List operations",
      description:
        "Paginate every operation this key can call, beyond the curated tools above — the full agent-reachable " +
        "surface. Filter by `resource` and/or `kind` (\"query\"|\"mutation\"). Mirrors `GET /api/v1/operations`.",
      inputSchema: {
        type: "object",
        properties: {
          resource: { type: "string" },
          kind: { type: "string", enum: ["query", "mutation"] },
          cursor: { type: "number" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      stability: "stable",
      operation: null,
    },
    {
      name: `${MCP_NAMESPACE}.describe_operation`,
      title: "Describe operation",
      description:
        "One operation's argument schema, required scope, idempotency requirement, and possible error codes. Call " +
        "this before `call_operation` for anything not covered by a curated tool.",
      inputSchema: {
        type: "object",
        properties: { operation: { type: "string", description: 'e.g. "assets.list"' } },
        required: ["operation"],
        additionalProperties: false,
      },
      stability: "stable",
      operation: null,
    },
    {
      name: `${MCP_NAMESPACE}.call_operation`,
      title: "Call operation",
      description:
        "Generic dispatch to any agent-reachable operation by name — the full agent-reachable surface, not just the " +
        'curated tools. `stability: "tracks-app"`: this surface follows the app\'s internals directly, so its shape ' +
        "can change between ordinary refactors — the curated tools above are the stable, additive-only contract. " +
        'Mutations always require `idempotencyKey`; `confirm` is reserved for the Phase 4 (#1000) `danger`-tier ' +
        "enforcement and is accepted today but not yet required by any operation.",
      inputSchema: {
        type: "object",
        properties: {
          operation: { type: "string", description: 'e.g. "lineItemWrites.addNative" — see list_operations/describe_operation.' },
          args: { type: "object", description: "The operation's own arguments. Server-injected fields (actor/id/orgId/…) are stripped automatically." },
          confirm: { type: "boolean", description: "Reserved for Phase 4 danger-tier enforcement." },
          idempotencyKey: IDEMPOTENCY_KEY_SCHEMA,
        },
        required: ["operation"],
        additionalProperties: false,
      },
      stability: "tracks-app",
      operation: null,
    },
  ];
}

function emit(curated: McpToolManifestEntry[], discovery: McpToolManifestEntry[]): string {
  return (
    "// GENERATED FILE — DO NOT EDIT.\n" +
    "// Run `pnpm run api:mcp` to regenerate; CI fails if this file is stale.\n" +
    "// Source of truth: src/lib/api/registry.generated.ts + src/lib/api/mcp/curated-tool-defs.ts.\n" +
    "// See scripts/generate-mcp-manifest.mts.\n" +
    "\n" +
    'export const MCP_NAMESPACE = "rvlt_flow.v1";\n' +
    "\n" +
    "export interface McpToolManifestEntry {\n" +
    "  readonly name: string;\n" +
    "  readonly title: string;\n" +
    "  readonly description: string;\n" +
    "  readonly inputSchema: Record<string, unknown>;\n" +
    '  readonly stability: "stable" | "tracks-app";\n' +
    "  readonly operation: string | null;\n" +
    "}\n" +
    "\n" +
    "export const MCP_CURATED_TOOLS: readonly McpToolManifestEntry[] = " +
    JSON.stringify(curated, null, 2) +
    " as const;\n" +
    "\n" +
    "export const MCP_DISCOVERY_TOOLS: readonly McpToolManifestEntry[] = " +
    JSON.stringify(discovery, null, 2) +
    " as const;\n" +
    "\n" +
    "export const MCP_TOOLS: readonly McpToolManifestEntry[] = [...MCP_CURATED_TOOLS, ...MCP_DISCOVERY_TOOLS];\n" +
    "\n" +
    "export const MCP_TOOLS_BY_NAME: ReadonlyMap<string, McpToolManifestEntry> = new Map(MCP_TOOLS.map((t) => [t.name, t]));\n"
  );
}

function runStalenessGate(path: string, contents: string): void {
  let existing: string;
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    existing = "";
  }
  if (existing !== contents) {
    console.error(
      `\n✖ MCP manifest staleness gate failed. Out of date:\n  - ${path}\n\n  Run \`pnpm run api:mcp\` and commit the result.\n`,
    );
    process.exit(1);
  }
}

function main(): void {
  const check = process.argv.includes("--check");
  const curated = buildCuratedTools();
  const discovery = buildDiscoveryTools();
  const contents = emit(curated, discovery);

  if (check) {
    runStalenessGate(OUT, contents);
    console.log(`✓ MCP manifest current — ${curated.length} curated tools + ${discovery.length} discovery tools.`);
    return;
  }

  writeFileSync(OUT, contents);
  console.log(`✓ Wrote MCP tool manifest (${curated.length} curated + ${discovery.length} discovery tools) to:\n  ${OUT}`);
}

main();
