import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import { enforceAgentReadLimit } from "./lib/rateLimiter";

/**
 * Dispatcher-only infrastructure for the Phase 2 API core (#998, design §11
 * observability). Two unrelated jobs share this module because both are
 * SERVICE-only Node-callable entry points the dispatcher needs and neither
 * belongs to a domain resource:
 *
 *   1. `spendReadLimit` — a Convex query can't write, so the `agentRead` token
 *      bucket (convex/lib/rateLimiter.ts `enforceAgentReadLimit`) can only be
 *      spent from a MUTATION. The dispatcher calls this once per inbound read
 *      request, under its own service token, before minting the caller's agent
 *      token and running the actual query.
 *   2. `logRequest`/`recentForKey`/`purgeOlderThan` — the per-key request log.
 *      Every dispatcher call (query or mutation, success or error) writes one
 *      row here; args arrive PRE-REDACTED (src/lib/api/request-log-redact.ts,
 *      R-8.12.4) — this table never sees a raw payload.
 */

export const spendReadLimit = mutation({
  args: { apiKeyId: v.string() },
  returns: v.null(),
  handler: async (ctx, { apiKeyId }) => {
    await requireService(ctx);
    await enforceAgentReadLimit(ctx, apiKeyId);
    return null;
  },
});

export const logRequest = mutation({
  args: {
    organizationId: v.string(),
    apiKeyId: v.string(),
    ts: v.number(),
    operation: v.string(),
    kind: v.union(v.literal("query"), v.literal("mutation")),
    status: v.union(v.literal("success"), v.literal("error")),
    errorCode: v.optional(v.string()),
    missingScope: v.optional(v.string()),
    latencyMs: v.number(),
    requestId: v.optional(v.string()),
    argsRedacted: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireService(ctx);
    await ctx.db.insert("apiRequestLog", args);
    return null;
  },
});

/** Most-recent-first, capped at 200 (design §11 "last ~200 calls") — the
 *  per-key request log a future Settings page (Phase 6, #1002) will render. */
export const recentForKey = query({
  args: { apiKeyId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { apiKeyId, limit }) => {
    await requireService(ctx);
    const cap = Math.min(limit ?? 200, 200);
    return await ctx.db
      .query("apiRequestLog")
      .withIndex("by_apiKeyId_ts", (q) => q.eq("apiKeyId", apiKeyId))
      .order("desc")
      .take(cap);
  },
});

/** T-P2 proposed retention window for apiRequestLog rows. */
const REQUEST_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Retention age-out — called by the daily "api-request-log-retention" cron
 *  (convex/crons.ts), NOT reachable from the dispatcher or any public surface.
 *  Bounded per tick so a large backlog can't blow the mutation's time/read
 *  limits; the cron just fires again next day and keeps draining. */
export const purgeOlderThan = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    // Same off-by-default rollout discipline as every other convex/crons.ts job
    // (see that file's docstring) — dormant until explicitly flipped on.
    if (process.env.ENABLE_CONVEX_CRONS !== "true") {
      console.log('[api-request-log-retention] disabled (ENABLE_CONVEX_CRONS != "true") — skipping');
      return 0;
    }
    const cutoffMs = Date.now() - REQUEST_LOG_RETENTION_MS;
    const stale = await ctx.db
      .query("apiRequestLog")
      .withIndex("by_organizationId_ts", (q) => q)
      .filter((q) => q.lt(q.field("ts"), cutoffMs))
      .take(2000);
    for (const row of stale) await ctx.db.delete(row._id);
    return stale.length;
  },
});
