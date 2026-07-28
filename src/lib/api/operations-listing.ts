import { API_REGISTRY, API_REGISTRY_BY_OPERATION } from "./registry.generated";
import { toPublicOperation, type PublicOperation } from "./public-operation";
import { KNOWN_ERROR_CODES } from "./errors";

/**
 * The paginated operation listing (design §11) — shared by `GET
 * /api/v1/operations` and the MCP `list_operations` discovery tool, so REST
 * and MCP enumerate the identical agent-reachable surface. Always closed by
 * default: the ~800 SERVICE-only operations are invisible here exactly as
 * they are to `/ops/{operation}` (404), so this can never be used to
 * enumerate what a leaked token can't reach.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ListOperationsFilter {
  resource?: string | null;
  kind?: string | null;
  cursor?: number | null;
  limit?: number | null;
}

export interface ListOperationsPage {
  data: PublicOperation[];
  total: number;
  cursor: number;
  nextCursor: number | null;
}

export function listOperationsPage(filter: ListOperationsFilter): ListOperationsPage {
  const cursor = Math.max(0, filter.cursor ?? 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, filter.limit ?? DEFAULT_LIMIT));

  const reachable = API_REGISTRY.filter((op) => {
    if (!op.agentReachable) return false;
    if (filter.resource && op.resource !== filter.resource) return false;
    if (filter.kind && op.kind !== filter.kind) return false;
    return true;
  });

  const page = reachable.slice(cursor, cursor + limit).map(toPublicOperation);
  const nextCursor = cursor + limit < reachable.length ? cursor + limit : null;

  return { data: page, total: reachable.length, cursor, nextCursor };
}

export interface DescribedOperation extends PublicOperation {
  possibleErrorCodes: readonly string[];
}

/** Same closed-by-default rule as the dispatcher: an unknown OR
 *  non-agent-reachable name reports as "not found", never "this exists but
 *  you can't use it" — that would leak the SERVICE-only surface's existence. */
export function describeOperation(operationName: string): DescribedOperation | null {
  const op = API_REGISTRY_BY_OPERATION.get(operationName);
  if (!op || !op.agentReachable) return null;
  return {
    ...toPublicOperation(op),
    // Every error code the envelope knows how to classify — not narrowed to
    // what THIS operation's guards happen to throw today (that set can grow
    // without a docs update, and the envelope degrades unknown codes safely).
    possibleErrorCodes: KNOWN_ERROR_CODES,
  };
}
