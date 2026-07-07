import { NextRequest, NextResponse } from "next/server";
import { handleMcpMessage, type JsonRpcRequest } from "@/lib/api/mcp";

const V1 = { "X-GearFlow-API-Version": "v1" };

/**
 * POST /api/v1/mcp — GearFlow's MCP server (Streamable HTTP, JSON-RPC 2.0).
 *
 * Point an MCP client here with `Authorization: Bearer <api key>`. Supports
 * `initialize`, `tools/list`, and `tools/call` (whoami, reserve_items). Notifications
 * are answered with 202. See docs/designs/api-mcp-agent-access.md.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  let msg: JsonRpcRequest;
  try {
    msg = (await request.json()) as JsonRpcRequest;
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400, headers: V1 },
    );
  }

  const response = await handleMcpMessage(msg, authHeader);

  // Notifications (no id) get no body.
  if (response === null) {
    return new NextResponse(null, { status: 202, headers: V1 });
  }

  return NextResponse.json(response, { headers: V1 });
}
