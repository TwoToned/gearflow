import { NextResponse } from "next/server";
import { authorizationServerMetadata } from "@/lib/api/oauth/metadata";
import { withCors, corsPreflight } from "@/lib/api/cors";

export const runtime = "nodejs";

/**
 * RFC 8414 authorization-server metadata (Phase 7, #1003). Deliberately
 * unauthenticated — a discovery document, not org data (same posture as
 * `GET /api/v1/openapi.json`). Public per `src/middleware.ts`'s exemption list.
 * CORS-open: browser-based MCP clients fetch this document directly to
 * discover the token/registration endpoints before they hold any credential.
 */
export async function GET() {
  return withCors(
    NextResponse.json(authorizationServerMetadata(), {
      headers: { "Cache-Control": "public, max-age=3600" },
    }),
  );
}

export const OPTIONS = corsPreflight;
