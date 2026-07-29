import { NextResponse } from "next/server";
import { authorizationServerMetadata } from "@/lib/api/oauth/metadata";

export const runtime = "nodejs";

/**
 * RFC 8414 authorization-server metadata (Phase 7, #1003). Deliberately
 * unauthenticated — a discovery document, not org data (same posture as
 * `GET /api/v1/openapi.json`). Public per `src/middleware.ts`'s exemption list.
 */
export async function GET() {
  return NextResponse.json(authorizationServerMetadata(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
