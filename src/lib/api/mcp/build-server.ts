import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { API_REGISTRY_BY_OPERATION } from "../registry.generated";
import { MCP_NAMESPACE, MCP_TOOLS, MCP_TOOLS_BY_NAME, type McpToolManifestEntry } from "../mcp-manifest.generated";
import { dispatch, type DispatchResult } from "../dispatcher";
import { listOperationsPage, describeOperation } from "../operations-listing";
import { getWhoamiData } from "../whoami";
import { toErrorEnvelope } from "../errors";
import type { AgentRequestContext } from "../agent-auth";
import { MCP_RESOURCES, readMcpResource } from "./resources";
import { MCP_PROMPTS, MCP_PROMPTS_BY_NAME } from "./prompts";

/**
 * The MCP surface (Phase 3, #999, design §12) — a protocol adapter with no
 * business logic of its own, built fresh per HTTP request (stateless
 * Streamable HTTP — src/app/api/v1/mcp/route.ts) around the SAME dispatcher
 * REST uses. Every tool call that isn't `whoami` ends at `dispatch()`, which
 * re-authenticates the bearer token itself — exactly as if it were a REST
 * call — so nothing here is trusted to have checked a gate.
 */

export interface BuildMcpServerOptions {
  /** Resolved once, up front, to gate the whole connection and to answer
   *  `whoami` without a redundant dispatch round-trip. */
  agent: AgentRequestContext;
  /** The raw `Authorization` header, re-validated by `dispatch()` on every
   *  tool call — the same re-validate-every-time posture the REST layer has
   *  always had (the 60s agent-token TTL is the whole point of that). */
  authorizationHeader: string | null;
  requestId: string | null;
}

function stripStructuredContent(body: unknown): Record<string, unknown> | undefined {
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
}

function toCallToolResult(body: unknown, isError: boolean): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
    structuredContent: stripStructuredContent(body),
    isError,
  };
}

function dispatchResultToToolResult(result: DispatchResult): CallToolResult {
  return toCallToolResult(result.body, result.status >= 400);
}

function errorToolResult(message: string, code: string): CallToolResult {
  return toCallToolResult(toErrorEnvelope(Object.assign(new Error(message), { code })), true);
}

/** `readOnlyHint`/`idempotentHint` (MCP tool annotations) — a light UX signal
 *  for clients that show confirmation UI before a write; not a security
 *  control, so it's fine to derive on a best-effort basis. */
function annotationsFor(entry: McpToolManifestEntry): Record<string, unknown> {
  if (entry.operation === null) {
    // whoami + the discovery tools other than call_operation are read-only;
    // call_operation is opaque (it can dispatch to either a query or a
    // mutation), so it gets no readOnlyHint at all rather than a wrong one.
    const readOnly = entry.name !== `${MCP_NAMESPACE}.call_operation`;
    return { title: entry.title, readOnlyHint: readOnly, openWorldHint: entry.name === `${MCP_NAMESPACE}.call_operation` };
  }
  const op = API_REGISTRY_BY_OPERATION.get(entry.operation);
  return { title: entry.title, readOnlyHint: op?.kind === "query", idempotentHint: op?.kind === "mutation" };
}

function stripNamespace(name: string): string {
  return name.startsWith(`${MCP_NAMESPACE}.`) ? name.slice(MCP_NAMESPACE.length + 1) : name;
}

async function handleCallOperation(
  args: Record<string, unknown>,
  opts: BuildMcpServerOptions,
): Promise<CallToolResult> {
  const operation = typeof args.operation === "string" ? args.operation : null;
  if (!operation) return errorToolResult('call_operation requires a string "operation" argument.', "VALIDATION_FAILED");
  const opArgs = args.args && typeof args.args === "object" && !Array.isArray(args.args) ? (args.args as Record<string, unknown>) : {};
  const idempotencyKey = typeof args.idempotencyKey === "string" ? args.idempotencyKey : undefined;
  const result = await dispatch(operation, { args: opArgs, idempotencyKey }, opts.authorizationHeader, opts.requestId);
  return dispatchResultToToolResult(result);
}

async function handleCuratedTool(entry: McpToolManifestEntry, args: Record<string, unknown>, opts: BuildMcpServerOptions): Promise<CallToolResult> {
  if (!entry.operation) {
    // The only operation:null curated tool is whoami, handled before this is reached.
    return errorToolResult(`Tool "${entry.name}" has no underlying operation.`, "UNKNOWN_OPERATION");
  }
  const { idempotencyKey, ...opArgs } = args;
  const result = await dispatch(
    entry.operation,
    { args: opArgs, idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : undefined },
    opts.authorizationHeader,
    opts.requestId,
  );
  return dispatchResultToToolResult(result);
}

async function handleWhoami(_args: Record<string, unknown>, opts: BuildMcpServerOptions): Promise<CallToolResult> {
  return toCallToolResult({ data: await getWhoamiData(opts.agent), requestId: opts.requestId }, false);
}

function handleListOperations(args: Record<string, unknown>, opts: BuildMcpServerOptions): CallToolResult {
  const page = listOperationsPage({
    resource: typeof args.resource === "string" ? args.resource : undefined,
    kind: typeof args.kind === "string" ? args.kind : undefined,
    cursor: typeof args.cursor === "number" ? args.cursor : undefined,
    limit: typeof args.limit === "number" ? args.limit : undefined,
  });
  return toCallToolResult({ ...page, requestId: opts.requestId }, false);
}

function handleDescribeOperation(args: Record<string, unknown>, opts: BuildMcpServerOptions): CallToolResult {
  const operation = typeof args.operation === "string" ? args.operation : "";
  const described = describeOperation(operation);
  if (!described) return errorToolResult(`No such operation: "${operation}".`, "UNKNOWN_OPERATION");
  return toCallToolResult({ data: described, requestId: opts.requestId }, false);
}

/** The four tools with no fixed underlying operation (design §12 tiers 2+3) —
 *  everything else is a 1:1 curated-tool → operation dispatch. Keyed on the
 *  BARE (unnamespaced) tool name, checked before the general `MCP_TOOLS_BY_NAME`
 *  lookup so this stays a flat dispatch table instead of an if/else chain. */
const SPECIAL_TOOL_HANDLERS: Record<
  string,
  (args: Record<string, unknown>, opts: BuildMcpServerOptions) => CallToolResult | Promise<CallToolResult>
> = {
  whoami: handleWhoami,
  list_operations: handleListOperations,
  describe_operation: handleDescribeOperation,
  call_operation: handleCallOperation,
};

export async function routeToolCall(name: string, rawArgs: unknown, opts: BuildMcpServerOptions): Promise<CallToolResult> {
  const args = rawArgs && typeof rawArgs === "object" ? (rawArgs as Record<string, unknown>) : {};
  const special = SPECIAL_TOOL_HANDLERS[stripNamespace(name)];
  if (special) return special(args, opts);

  const entry = MCP_TOOLS_BY_NAME.get(name);
  if (!entry) return errorToolResult(`No such tool: "${name}". Call tools/list, or use call_operation for anything not curated.`, "UNKNOWN_OPERATION");
  return handleCuratedTool(entry, args, opts);
}

export function buildMcpServer(opts: BuildMcpServerOptions): Server {
  const server = new Server(
    { name: "rvlt-flow", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: MCP_TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema as { type: "object"; properties?: Record<string, object>; required?: string[] },
      annotations: annotationsFor(t),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => routeToolCall(request.params.name, request.params.arguments, opts));

  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: MCP_RESOURCES }));

  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const resource = readMcpResource(request.params.uri);
    if (!resource) throw new Error(`No such resource: "${request.params.uri}".`);
    return { contents: [{ uri: request.params.uri, mimeType: resource.mimeType, text: resource.text }] };
  });

  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: MCP_PROMPTS.map((p) => ({ name: p.name, title: p.title, description: p.description, arguments: p.args })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const prompt = MCP_PROMPTS_BY_NAME.get(request.params.name);
    if (!prompt) throw new Error(`No such prompt: "${request.params.name}".`);
    const text = prompt.render((request.params.arguments as Record<string, string>) ?? {});
    return { description: prompt.description, messages: [{ role: "user", content: { type: "text", text } }] };
  });

  return server;
}
