import { NextResponse } from "next/server";
import { protectedResourceMetadata } from "@/lib/api/oauth/metadata";
import { withCors, corsPreflight } from "@/lib/api/cors";

export const runtime = "nodejs";

/**
 * RFC 9728 protected-resource metadata for `/api/v1/mcp`, per the MCP
 * authorization spec — points an MCP client at the authorization server it
 * should use. Unauthenticated discovery document, same posture as the
 * authorization-server metadata route. CORS-open for the same reason.
 */
export async function GET() {
  return withCors(
    NextResponse.json(protectedResourceMetadata(), {
      headers: { "Cache-Control": "public, max-age=3600" },
    }),
  );
}

export const OPTIONS = corsPreflight;
