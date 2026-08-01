import { ConvexError } from "convex/values";
import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getAuthContext } from "./auth";
import {
  AGENT_READ_LIMIT,
  AGENT_WRITE_LIMIT,
  BROWSER_WRITE_LIMIT,
  MAX_BULK_ITEMS,
  MAX_BULK_ITEMS_AGENT,
} from "./rateLimits";

/**
 * Rate limiting for the browser-direct mutation surface (Phase 3 security baseline).
 *
 * Once the browser calls Convex mutations directly there is no server-action tier in
 * front to throttle abuse, so a runaway/hostile USER token could hammer the public
 * mutation surface. This caps sustained per-user write rate while still allowing
 * legitimate bursts (rapid optimistic edits; a bulk action is ONE array mutation, so
 * it costs one token regardless of item count).
 *
 * SERVICE-token (trusted backend) writes are NOT limited — the server does its own
 * throttling and runs legitimate bulk/backfill operations.
 *
 * `limit(..., { throws: true })` throws a `ConvexError` whose payload has
 * `kind: "RateLimited"` (detectable client-side via `isRateLimitError`) plus a
 * `retryAfter` — that payload survives the production boundary, unlike a plain Error.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Per-user browser-direct write budget. Token bucket = burst up to `capacity`,
  // refilling at `rate` per `period`. 300/min sustained (5/s) with a 100-op burst
  // comfortably covers rapid optimistic editing yet stops a runaway client loop.
  browserWrite: { kind: "token bucket", rate: BROWSER_WRITE_LIMIT.rate, period: MINUTE, capacity: BROWSER_WRITE_LIMIT.capacity },

  // Agent (API-key) budgets, keyed on `apiKeyId` — NOT the token subject. An agent
  // token's subject IS a real human, so sharing the `browserWrite` bucket would let
  // a looping agent starve the person it acts as out of their own UI. Separate
  // buckets keep the blast radius on the key.
  //
  // Deliberately far below the human write budget: a runaway agent should be
  // throttled long before a human notices anything. Starting values from
  // docs/designs/api-mcp-reimplementation.md §16.1 — calibrate against one real
  // MCP session in Phase 3. Numbers live in ./rateLimits.ts (R-3.1) so
  // `/api/v1/whoami` can publish them without importing this Convex-component-
  // bound module into Node.
  agentRead: { kind: "token bucket", rate: AGENT_READ_LIMIT.rate, period: MINUTE, capacity: AGENT_READ_LIMIT.capacity },
  agentWrite: { kind: "token bucket", rate: AGENT_WRITE_LIMIT.rate, period: MINUTE, capacity: AGENT_WRITE_LIMIT.capacity },
});

/**
 * Enforce the per-actor write budget. USER tokens spend `browserWrite` keyed on
 * `(orgId, userId)`; AGENT tokens spend `agentWrite` keyed on the API key (which
 * is itself already org-scoped — one key belongs to exactly one org — so no
 * further widening is needed there). No-op for service/anonymous (service =
 * trusted backend; anonymous is rejected by the mutation's own auth guard).
 * Keyed on VERIFIED token claims — a client can't dodge its budget by supplying
 * a different id. Throws when the budget is exceeded. Call it FIRST in every
 * browser-direct mutation, alongside `assertWritesEnabled`.
 *
 * Named for its original browser-only role; it is now the single write-budget
 * entry point for every non-service caller, so agents inherit it at all ~272
 * existing call sites with no per-mutation change.
 *
 * #1077 (A7): keying `browserWrite` on `userId` ALONE was per-user, not
 * per-tenant — safe against one user's writes throttling a DIFFERENT user
 * (different key regardless of org), but it let a single multi-org user's
 * budget bleed across their own orgs (heavy writes in org A could throttle the
 * same person's unrelated activity in org B). Composing the key with `orgId`
 * gives every (user, org) pair its own independent bucket, matching how a
 * membership is scoped everywhere else.
 */
export async function enforceBrowserWriteLimit(ctx: MutationCtx): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (!auth) return;
  if (auth.kind === "agent") {
    await rateLimiter.limit(ctx, "agentWrite", { key: auth.apiKeyId, throws: true });
    return;
  }
  if (auth.kind !== "user") return;
  await rateLimiter.limit(ctx, "browserWrite", { key: `${auth.orgId ?? "no-org"}:${auth.userId}`, throws: true });
}

/**
 * Spend one `agentRead` token for an API key. Reads can't self-limit (a Convex
 * query can't write, and the token bucket is stateful), so this is called by the
 * API/MCP dispatcher — which runs in Node with the service token — once per
 * inbound read request, before it mints the agent token and forwards the call.
 */
export async function enforceAgentReadLimit(
  ctx: MutationCtx,
  apiKeyId: string,
): Promise<void> {
  await rateLimiter.limit(ctx, "agentRead", { key: apiKeyId, throws: true });
}

/** Per-call cap for `ids`/`items` arrays on bulk browser-direct mutations
 *  (removeManyNative/patchManyNative/reorderNative/…). `enforceBrowserWriteLimit`
 *  costs ONE token per call regardless of array size (deliberately, so a legit bulk
 *  action isn't rate-limited per-item) — without a size cap, a single call with an
 *  oversized array becomes an uncapped amplification vector: one rate-limit token
 *  buys N point-queries/writes inside one transaction. 500 comfortably covers the
 *  largest real bulk UI action (select-all on a big project) with headroom. */
export { MAX_BULK_ITEMS };

/** The same cap for AGENT callers. A human select-all is a deliberate, visible act
 *  with an undo path; one confused agent call is neither, so its blast radius is an
 *  order of magnitude smaller and over-cap tells it to split the batch. */
export { MAX_BULK_ITEMS_AGENT };

/**
 * Enforce the bulk-array cap for the caller's auth kind (50 agent / 500 human).
 * Async + ctx-taking because the cap depends on the verified identity, which is
 * the only trustworthy source — a caller-supplied hint would defeat the point.
 */
export async function assertBulkSizeOk(
  ctx: QueryCtx | MutationCtx,
  count: number,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  const cap = auth?.kind === "agent" ? MAX_BULK_ITEMS_AGENT : MAX_BULK_ITEMS;
  if (count > cap) {
    throw new ConvexError({
      code: "BULK_TOO_LARGE",
      message: `Bulk operation exceeds the ${cap}-item limit (got ${count}). Split it into smaller batches.`,
    });
  }
}
