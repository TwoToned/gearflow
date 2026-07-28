import { NextResponse, type NextRequest } from "next/server";
import { dispatch } from "./dispatcher";

/**
 * Curated typed REST aliases (design §11) — a handful of conventional
 * `GET /api/v1/projects`, `GET /api/v1/projects/{id}`, `POST /api/v1/projects/
 * {id}/line-items`-shaped routes over the SAME dispatcher `/ops/{operation}`
 * uses. An alias route is a few lines that name an operation and merge path
 * params into `args`; every gate, the idempotency ledger, rate limiting, and
 * the error envelope come along for free because it's the identical
 * `dispatch()` call — REST and the generic dispatcher literally cannot drift
 * from each other, because one calls the other.
 *
 * Not a generator (unlike the registry/OpenAPI/llms.txt outputs): the point of
 * an alias is to be a hand-picked ergonomic shortcut for a handful of common
 * calls, not full coverage — `/ops/{operation}` already covers every
 * agent-reachable operation. Extend this list as real usage shows which
 * shortcuts are worth having.
 */
export async function dispatchAlias(
  operation: string,
  args: Record<string, unknown>,
  request: NextRequest,
  extra?: { idempotencyKey?: string },
): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id");
  const result = await dispatch(
    operation,
    { args, idempotencyKey: extra?.idempotencyKey },
    request.headers.get("authorization"),
    requestId,
  );
  return NextResponse.json(result.body, { status: result.status });
}

/** Reads `?orgId=` isn't needed — the org always comes from the key
 *  (arg-normalizer.ts), so alias routes never need to accept it from the
 *  caller. This helper exists only to keep that fact visible at each call site
 *  instead of an unexplained `{}`. */
export const NO_EXTRA_ARGS = {} as const;
