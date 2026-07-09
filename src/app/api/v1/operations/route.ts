import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, toErrorEnvelope } from "@/lib/api/http";
import { listOperations } from "@/lib/api/dispatch";

// AsyncLocalStorage (node:async_hooks) backs the ambient actor.
export const runtime = "nodejs";

const V1 = { "X-GearFlow-API-Version": "v1" };

/**
 * GET /api/v1/operations — discover every operation this key can call.
 *
 * Query: ?search=&kind=read|write&module=&limit=&includeUnauthorized=true
 * By default the list is filtered to the key's scopes, so it reflects real
 * capability rather than the full catalogue. Each entry says whether it is
 * `dangerous` and whether it `requiresConfirmation`.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await authenticateApiRequest(request.headers.get("authorization"));
    const q = request.nextUrl.searchParams;
    const kind = q.get("kind");

    const result = listOperations(actor, {
      search: q.get("search") ?? undefined,
      kind: kind === "read" || kind === "write" ? kind : undefined,
      module: q.get("module") ?? undefined,
      includeUnauthorized: q.get("includeUnauthorized") === "true",
      limit: q.get("limit") ? Number(q.get("limit")) : undefined,
    });

    return NextResponse.json(result, { headers: V1 });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err);
    return NextResponse.json(body, { status, headers: V1 });
  }
}
