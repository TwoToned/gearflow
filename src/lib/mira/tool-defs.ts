import { CURATED_TOOL_DEFS } from "@/lib/api/mcp/curated-tool-defs";
import { MCP_TOOLS_BY_NAME, MCP_NAMESPACE } from "@/lib/api/mcp-manifest.generated";
import { API_REGISTRY_BY_OPERATION } from "@/lib/api/registry.generated";
import type { JsonSchema } from "@/lib/api/json-schema";

/**
 * Mira's tool surface: the SAME curated MCP tool catalog
 * (src/lib/api/mcp/curated-tool-defs.ts) an external MCP client sees, filtered
 * down to what this particular call is actually allowed to attempt. Curated
 * tools only — never the raw `call_operation` escape hatch or the full
 * agent-reachable registry — so the model reasons over ~20 well-described
 * jobs instead of ~500 raw Convex functions (FEATUREDOCS/68, "the curated MCP
 * tool set routeMiraQuestion dispatches into").
 *
 * `idempotencyKey` and `confirm` are stripped from what the model sees:
 * idempotency is infra plumbing the agent loop generates itself
 * (src/lib/mira/agent-loop.ts), and `confirm` is NEVER offered to the model at
 * all — only a human clicking "Confirm" in the chat UI can set it
 * (src/server/mira.ts `confirmMiraPendingAction`), never the LLM retrying its
 * own tool call. This is a stronger safety property than the raw MCP surface:
 * even a successfully prompt-injected model has no parameter to self-approve
 * a high-danger action with.
 */

export interface MiraTool {
  /** Bare name, e.g. "search_assets" — what the model calls it. */
  name: string;
  description: string;
  operation: string | null;
  isWrite: boolean;
  danger: "low" | "medium" | "high" | null;
  parameters: JsonSchema;
}

function stripKeys(schema: JsonSchema, keys: readonly string[]): JsonSchema {
  const properties = { ...((schema.properties as Record<string, JsonSchema>) ?? {}) };
  for (const key of keys) delete properties[key];
  const required = ((schema.required as string[]) ?? []).filter((k) => !keys.includes(k));
  const { required: _unusedRequired, ...rest } = schema;
  return { ...rest, properties, ...(required.length ? { required } : {}) };
}

/** Does the preset's granted scope set actually cover every scope this
 *  mutation requires? A tool offered without this would always fail with a
 *  permission error — better to not offer it at all than have the model
 *  confidently promise something it structurally cannot do. */
function scopesCovered(requiredScopes: readonly { resource: string; action: string }[], grantedScopes: ReadonlySet<string>): boolean {
  return requiredScopes.every((s) => grantedScopes.has(`${s.resource}:${s.action}`));
}

export interface BuildMiraToolsOptions {
  /** Whether this org has opted Mira into write access at all
   *  (miraOrgSettings.writeAccessEnabled) — the coarse, org-level gate. */
  includeWrites: boolean;
  /** The scope set Mira's own provisioned key actually carries (the preset's
   *  scopes) — the fine-grained gate: even with writes enabled org-wide, a
   *  tool whose operation needs a scope no preset grants (e.g. dispatch_gear's
   *  warehouse:check_out — deliberately excluded from full_agent) is never
   *  offered. Convex's own RBAC check is still the real enforcement; this is
   *  just "don't advertise a button that's always going to fail." */
  grantedScopes: ReadonlySet<string>;
}

export function buildMiraTools(opts: BuildMiraToolsOptions): MiraTool[] {
  const tools: MiraTool[] = [];
  for (const def of CURATED_TOOL_DEFS) {
    const manifestEntry = MCP_TOOLS_BY_NAME.get(`${MCP_NAMESPACE}.${def.name}`);
    if (!manifestEntry) continue; // generator invariant — every curated def has a manifest entry
    const op = def.operation ? API_REGISTRY_BY_OPERATION.get(def.operation) : null;
    const isWrite = op?.kind === "mutation";

    if (isWrite && !opts.includeWrites) continue;
    if (isWrite && op && !scopesCovered(op.scopePairs, opts.grantedScopes)) continue;

    tools.push({
      name: def.name,
      description: manifestEntry.description,
      operation: def.operation,
      isWrite,
      danger: op?.danger ?? null,
      parameters: stripKeys(manifestEntry.inputSchema as JsonSchema, ["idempotencyKey", "confirm"]),
    });
  }
  return tools;
}

export function findMiraTool(tools: readonly MiraTool[], name: string): MiraTool | undefined {
  return tools.find((t) => t.name === name);
}
