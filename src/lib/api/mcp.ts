import { authenticateApiRequest, toErrorEnvelope } from "./http";
import { reserveItems } from "./reserve-items";
import { convexReservationPort } from "./reserve-port";
import { ApiError } from "./errors";

/**
 * Minimal MCP (Model Context Protocol) server over Streamable HTTP (JSON-RPC 2.0).
 * Exposes GearFlow capability verbs as MCP tools so an agent (Claude, OpenClaw, …)
 * can call them natively. Handles `initialize`, `tools/list`, and `tools/call`;
 * notifications get no response. Tool DESCRIPTIONS are treated as the docs/prompt —
 * each states prerequisites, effect, preview behaviour, required scope, and idempotency.
 *
 * See docs/designs/api-mcp-agent-access.md.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_INFO = { name: "gearflow", version: "v1" } as const;

export const MCP_TOOLS = [
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
] as const;

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
    default:
      throw new ApiError("NOT_FOUND", `Unknown tool: ${name}`);
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
          capabilities: { tools: {} },
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
