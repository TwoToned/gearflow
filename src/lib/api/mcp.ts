import { authenticateApiRequest, toErrorEnvelope } from "./http";
import { reserveItems } from "./reserve-items";
import { convexReservationPort } from "./reserve-port";
import { ApiError } from "./errors";
import { CURATED_TOOLS, CURATED_BY_NAME, mapToolArgs } from "./mcp-tools";
import {
  invokeOperation,
  listOperations,
  describeOperation,
  TOTAL_OPERATIONS,
  type InvokeResult,
} from "./dispatch";

/**
 * MCP (Model Context Protocol) server over Streamable HTTP (JSON-RPC 2.0).
 * Handles `initialize`, `tools/list`, and `tools/call`; notifications get no
 * response. Tool DESCRIPTIONS are treated as the docs/prompt — each states
 * prerequisites, effect, preview behaviour, required scope, and idempotency.
 *
 * The tool list is deliberately two-tier. Named tools cover the common flows;
 * `list_operations`/`describe_operation`/`call_operation` reach the full ~508
 * operations — everything a user can do in the web app. Publishing all of them as
 * individual tools would swamp the agent's context and degrade tool selection.
 *
 * Every tool ultimately runs a guarded server action through the shared dispatcher,
 * so MCP has no write path of its own.
 *
 * See docs/designs/api-mcp-agent-access.md.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_INFO = { name: "gearflow", version: "v1" } as const;

/** Tools that exist only in MCP (no registry operation behind them). */
const META_TOOLS = [
  {
    name: "whoami",
    description:
      "Verify your API key and see what it can do. Returns the organization, the user it acts as, and the granted scopes. Read-only. Call this first to confirm the connection works. No arguments.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "reserve_items",
    description:
      "Hold gear on a project. Prerequisite: an existing projectId. Effect: reserves N of each model as line items (transitions toward a booking). PREVIEW by default (confirm=false) — returns per-item availability + conflicts and writes nothing; set confirm=true to commit. A commit REQUIRES idempotencyKey so a retry can't double-book. Required scope: project:manage_line_items. v1 supports model-based items only. Errors you may see: INVENTORY_CONFLICT (not enough free stock — see details), MISSING_SCOPE, VALIDATION_ERROR.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "The project to reserve onto." },
        items: {
          type: "array",
          description: "Models to hold and how many of each.",
          items: {
            type: "object",
            properties: {
              modelId: { type: "string" },
              quantity: { type: "integer", minimum: 1 },
            },
            required: ["modelId", "quantity"],
          },
        },
        confirm: {
          type: "boolean",
          description: "false = preview availability (default); true = commit the reservation.",
        },
        idempotencyKey: {
          type: "string",
          description: "Required when confirm=true. A unique id for this reservation so retries are safe.",
        },
      },
      required: ["projectId", "items"],
    },
  },
  {
    name: "list_operations",
    description:
      `Discover operations beyond the named tools. GearFlow exposes ${TOTAL_OPERATIONS} operations — everything the web app can do — and the named tools cover only the common ones. Results are filtered to what YOUR key is scoped for. Read-only. Each result says whether it is 'dangerous' and whether it 'requiresConfirmation'. Then call describe_operation for the exact arguments, and call_operation to run it.`,
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Match against operation name and summary, e.g. 'maintenance' or 'invoice'." },
        kind: { type: "string", enum: ["read", "write"], description: "Only reads, or only writes." },
        module: { type: "string", description: "Restrict to one module, e.g. 'projects' or 'warehouse'." },
        limit: { type: "integer", description: "Max results per page (default 100)." },
        offset: { type: "integer", description: "Skip this many results. Page with limit+offset; the response reports total, offset and hasMore." },
      },
    },
  },
  {
    name: "describe_operation",
    description:
      "Get the exact call signature of one operation: its parameters, each with real JSON Schema, the scope it needs, and whether it requires confirm=true. Read-only. Accepts either an operation name (assets.getAssets) or the MCP tool name that runs it (search_assets). Always call this before call_operation — argument names are validated strictly and a typo is rejected, not ignored.",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", description: "Operation name from list_operations, e.g. 'maintenance.createMaintenanceRecord'." },
      },
      required: ["operation"],
    },
  },
  {
    name: "call_operation",
    description:
      "Run any operation by name — the escape hatch that makes every app read and write reachable. Accepts an operation name or an MCP tool name as an alias. Pass arguments keyed by parameter name exactly as describe_operation reports them. Irreversible operations (delete/remove/archive) and stock-affecting ones (check-out, check-in, adding line items) refuse to run unless you pass confirm=true AND an idempotencyKey; you will get CONFIRMATION_REQUIRED or IDEMPOTENCY_KEY_REQUIRED telling you which is missing. Everything else commits directly. The operation runs as your key's acting user under the same permissions and business rules as the web UI.",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", description: "Operation name, e.g. 'projects.archiveProject'." },
        arguments: { type: "object", description: "Arguments keyed by parameter name." },
        confirm: { type: "boolean", description: "Required (true) for irreversible or stock-affecting operations." },
        idempotencyKey: { type: "string", description: "Required alongside confirm. A unique id so a retry cannot apply the change twice." },
      },
      required: ["operation"],
    },
  },
] as const;

/** The full advertised tool list: meta tools + one named tool per curated operation. */
export const MCP_TOOLS = [
  ...META_TOOLS,
  ...CURATED_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
];

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Unwrap the dispatcher's envelope for curated tools — the agent asked for a project, not a wrapper. */
function unwrap(res: InvokeResult): unknown {
  return res.replayed ? { replayed: true, result: res.result } : res.result;
}

/** Dispatch a single authenticated tool call. Throws ApiError/ApiKeyAuthError on failure. */
async function callTool(
  name: string,
  args: Record<string, unknown>,
  authHeader: string | null | undefined,
): Promise<unknown> {
  const actor = await authenticateApiRequest(authHeader);

  switch (name) {
    case "whoami":
      return {
        organizationId: actor.organizationId,
        actingUserId: actor.userId,
        actingUserName: actor.userName,
        actorType: actor.actorType,
        scopes: actor.scopes ?? [],
        operationsAvailable: listOperations(actor, { limit: 0 }).total,
      };

    case "reserve_items":
      return reserveItems(
        actor,
        {
          projectId: args.projectId as string,
          items: args.items as { modelId?: string; assetId?: string; quantity: number }[],
          confirm: args.confirm === true,
          idempotencyKey: args.idempotencyKey as string | undefined,
        },
        convexReservationPort,
      );

    case "list_operations":
      return listOperations(actor, {
        search: args.search as string | undefined,
        kind: args.kind as "read" | "write" | undefined,
        module: args.module as string | undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
        offset: typeof args.offset === "number" ? args.offset : undefined,
      });

    case "describe_operation":
      return describeOperation(args.operation as string);

    case "call_operation":
      return invokeOperation(actor, {
        operation: args.operation as string,
        arguments: (args.arguments as Record<string, unknown>) ?? {},
        confirm: args.confirm === true,
        idempotencyKey: args.idempotencyKey as string | undefined,
      });

    default: {
      // Curated tools are aliases over registry operations — same dispatcher,
      // same guards, friendlier argument names.
      const tool = CURATED_BY_NAME.get(name);
      if (!tool) throw new ApiError("NOT_FOUND", `Unknown tool: ${name}`);

      // `confirm`/`idempotencyKey` are dispatcher controls, not operation
      // parameters. Strip them before mapping, or an agent that helpfully passes
      // them (as call_operation's docs teach) trips the unknown-argument check.
      const { confirm, idempotencyKey, ...operationArgs } = args;

      const res = await invokeOperation(actor, {
        operation: tool.operation,
        arguments: mapToolArgs(tool, operationArgs),
        confirm: confirm === true,
        idempotencyKey: idempotencyKey as string | undefined,
      });
      return unwrap(res);
    }
  }
}

/**
 * Handle one JSON-RPC message. Returns the response object, or null for a
 * notification (no id / notifications/*), which the transport answers with 202.
 */
export async function handleMcpMessage(
  msg: JsonRpcRequest,
  authHeader: string | null | undefined,
): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;

  // Notifications (e.g. notifications/initialized) get no response.
  if (msg.id === undefined || msg.method.startsWith("notifications/")) {
    return null;
  }

  switch (msg.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          // `listChanged` tells a client the tool list is not immutable. We cannot
          // PUSH the notification over plain request/response HTTP, so a client that
          // caches the list from a previous connection will keep serving a stale one
          // until it reconnects — which is exactly how an agent ended up seeing only
          // the two tools that existed before a deploy. Advertising the capability at
          // least makes the staleness detectable.
          capabilities: { tools: { listChanged: true } },
          serverInfo: MCP_SERVER_INFO,
        },
      };

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };

    case "tools/call": {
      const params = msg.params ?? {};
      const name = params.name as string;
      const args = (params.arguments as Record<string, unknown>) ?? {};
      try {
        const data = await callTool(name, args, authHeader);
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(data) }] },
        };
      } catch (err) {
        // Surface a STRUCTURED, agent-actionable error as an isError tool result
        // (not a transport error) so the model can read and recover from it.
        const { body } = toErrorEnvelope(err);
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(body) }], isError: true },
        };
      }
    }

    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}
