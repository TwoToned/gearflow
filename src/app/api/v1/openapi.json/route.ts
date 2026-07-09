import { NextResponse } from "next/server";
import { getOpenApiDocument } from "@/lib/api/openapi";

export const runtime = "nodejs";

/**
 * GET /api/v1/openapi.json — the full OpenAPI 3.1 description of every operation,
 * generated from the same registry the dispatcher runs on.
 *
 * Unauthenticated: it describes the shape of the API, never any org's data. The
 * document is large (537 operations) — agents should use `GET /api/v1/operations`
 * instead, which is scope-filtered and paginated. This exists for humans, SDK
 * generators, and request-validation tooling.
 */
export function GET() {
  return NextResponse.json(getOpenApiDocument(), {
    headers: {
      "X-GearFlow-API-Version": "v1",
      // Static for the life of a deploy; safe to cache at the edge.
      "Cache-Control": "public, max-age=300",
    },
  });
}
