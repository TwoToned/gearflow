import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, toErrorEnvelope } from "@/lib/api/http";
import { listOperations } from "@/lib/api/dispatch";

// AsyncLocalStorage (node:async_hooks) backs the ambient actor.
export const runtime = "nodejs";

// The operation list is filtered per-key, so it must never be cached by an
// intermediary that doesn't vary on Authorization.
const V1 = { "X-GearFlow-API-Version": "v1", "Cache-Control": "no-store" };

/**
 * GET /api/v1/operations — discover every operation this key can call.
 *
 * Query: ?search=&kind=read|write&module=&limit=&offset=&includeUnauthorized=true
 * By default the list is filtered to the key's scopes, so it reflects real
 * capability rather than the full catalogue. Each entry says whether it is
 * `dangerous` and whether it `requiresConfirmation`.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await authenticateApiRequest(request.headers.get("authorization"));
    const q = request.nextUrl.searchParams;
    const kind = q.get("kind");

    // `?limit=abc` would become NaN and silently return an empty catalogue.
    const nonNegativeInt = (raw: string | null): number | undefined => {
      if (raw === null) return undefined;
      const n = Number(raw);
      return Number.isInteger(n) && n >= 0 ? n : undefined;
    };
    const limit = nonNegativeInt(q.get("limit"));
    const offset = nonNegativeInt(q.get("offset"));

    const result = listOperations(actor, {
      search: q.get("search") ?? undefined,
      kind: kind === "read" || kind === "write" ? kind : undefined,
      module: q.get("module") ?? undefined,
      includeUnauthorized: q.get("includeUnauthorized") === "true",
      limit,
      offset,
    });

    return NextResponse.json(result, { headers: V1 });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err);
    return NextResponse.json(body, { status, headers: V1 });
  }
}
