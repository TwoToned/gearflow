import { NextResponse } from "next/server";
import { OPENAPI_DOCUMENT } from "@/lib/api/openapi.generated";

export const runtime = "nodejs";

/**
 * `GET /api/v1/openapi.json` — the full machine-readable contract (design
 * §11). Deliberately UNAUTHENTICATED, unlike every other `/api/v1` route: it's
 * a schema document with no org data in it, and the whole point is that a
 * tool (Postman, an MCP client, a codegen step) can fetch it before it has a
 * key. Generated from the registry (scripts/generate-api-docs.mts) — never
 * hand-authored, so it can't drift from what `/ops/{operation}` actually does.
 */
export async function GET() {
  return NextResponse.json(OPENAPI_DOCUMENT, {
    headers: { "cache-control": "public, max-age=300" },
  });
}
