import { NextResponse } from "next/server";
import { API_DOCS_URL } from "@/lib/api/http";

/**
 * GET /api/v1 — unauthenticated discovery index. Points an agent that lands on the
 * base URL at the full docs, the MCP endpoint, and the available REST endpoints.
 * See docs/designs/api-mcp-agent-access.md and the docs at /llms.txt.
 */
export function GET() {
  return NextResponse.json(
    {
      name: "GearFlow API",
      apiVersion: "v1",
      description:
        "Agent-accessible API + MCP for GearFlow rental/asset management. Authenticate with 'Authorization: Bearer <api key>'. Read the docs before calling.",
      documentation_url: API_DOCS_URL,
      mcp: {
        url: "/api/v1/mcp",
        transport: "streamable-http (JSON-RPC 2.0)",
      },
      endpoints: {
        whoami: "GET /api/v1/whoami",
        list_operations: "GET /api/v1/operations",
        describe_operation: "GET /api/v1/operations/{name}",
        invoke_operation: "POST /api/v1/ops/{name}",
        reserve_items: "POST /api/v1/reserve-items",
        openapi: "GET /api/v1/openapi.json",
      },
      coverage:
        "Every read and write the web app can perform is exposed as an operation. Start at GET /api/v1/operations to discover what your key can call.",
      auth: "Authorization: Bearer <api key> (create one in Settings → Integrations → API Keys)",
    },
    { headers: { "Cache-Control": "no-store", "X-GearFlow-API-Version": "v1" } },
  );
}
