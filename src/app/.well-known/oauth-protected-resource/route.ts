import { NextResponse } from "next/server";
import { protectedResourceMetadata } from "@/lib/api/oauth/metadata";

export const runtime = "nodejs";

/**
 * RFC 9728 protected-resource metadata for `/api/v1/mcp`, per the MCP
 * authorization spec — points an MCP client at the authorization server it
 * should use. Unauthenticated discovery document, same posture as the
 * authorization-server metadata route.
 */
export async function GET() {
  return NextResponse.json(protectedResourceMetadata(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
