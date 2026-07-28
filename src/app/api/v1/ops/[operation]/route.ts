import { NextResponse, type NextRequest } from "next/server";
import { dispatch } from "@/lib/api/dispatcher";
import { toErrorEnvelope } from "@/lib/api/errors";
import { withApiVersionHeader } from "@/lib/api/version";

/**
 * `POST /api/v1/ops/{operation}` — the universal dispatcher (design §7, §11).
 * Replaces the Phase-0 throwaway `/api/v1/probe/line-items` route wholesale:
 * ONE route, backed by the generated registry instead of a hard-coded call.
 *
 * `runtime = "nodejs"` — the token minter uses `node:crypto` via Better Auth.
 * Bearer-only auth (R-8.11.1: CSRF is structurally N/A, there is no cookie
 * path). No CORS headers are added here — the default same-origin browser
 * policy applies (deny by default); non-browser clients (curl, MCP, scripts)
 * are unaffected by CORS entirely.
 */
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ operation: string }> },
) {
  const { operation } = await params;
  const requestId = request.headers.get("x-request-id");

  let rawBody: unknown = {};
  const text = await request.text();
  if (text.length > 0) {
    try {
      rawBody = JSON.parse(text);
    } catch {
      return withApiVersionHeader(NextResponse.json(
        toErrorEnvelope(Object.assign(new Error("Invalid JSON body."), { code: "VALIDATION_FAILED" }), { requestId }),
        { status: 400 },
      ));
    }
  }

  const result = await dispatch(operation, rawBody, request.headers.get("authorization"), requestId);
  return withApiVersionHeader(NextResponse.json(result.body, { status: result.status }));
}
