import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * The API/MCP write-replay ledger (docs/designs/api-mcp-reimplementation.md §9).
 *
 * Every agent write carries an `idempotencyKey`. The dispatcher runs three steps
 * around the real operation:
 *
 *   1. `claim`  — insert PENDING, or short-circuit with the stored result
 *                 (`REPLAYED`) / a retryable `IN_PROGRESS`.
 *   2. …run the operation under the AGENT token…
 *   3. `complete` — flip to DONE and store the result for future replays.
 *
 * These functions are SERVICE-only on purpose. The ledger is dispatcher
 * infrastructure, not a domain operation: an agent token must not be able to mark
 * its own claims done, forge a stored result, or read another key's ledger rows.
 * The dispatcher already runs in Node with the service token, so it pays nothing
 * for this; the agent token is used only for the wrapped operation itself.
 *
 * IMPORTANT — this ledger is a *deduplication cache*, not the correctness
 * guarantee. It is deliberately not atomic with the effect, and the actual
 * double-write defence is deterministic id derivation
 * (`src/lib/api/idempotency.ts`): the entity `id`/`auditId` are derived from
 * `(idempotencyKey, operation)`, so a retry after a crash between step 2 and step
 * 3 re-derives the same id and the target mutation's own `by_cuid` duplicate guard
 * rejects the second insert even when this ledger says PENDING. Decision 8 accepts
 * that trade over threading an idempotency arg through 223 mutations.
 */

/** Stable claim outcomes. `REPLAYED` is a SUCCESS the dispatcher returns verbatim
 *  (with `replayed: true`), not an error — retrying a write that already happened
 *  is exactly what an idempotency key is for. */
const claimResult = v.union(
  v.object({ status: v.literal("CLAIMED") }),
  v.object({ status: v.literal("REPLAYED"), result: v.optional(v.any()) }),
  v.object({ status: v.literal("IN_PROGRESS") }),
);

export const claim = mutation({
  args: {
    organizationId: v.string(),
    apiKeyId: v.string(),
    key: v.string(),
    operation: v.string(),
    argsHash: v.string(),
    now: v.number(),
  },
  returns: claimResult,
  handler: async (ctx, { organizationId, apiKeyId, key, operation, argsHash, now }) => {
    await requireService(ctx);
    // Scoped by (org, key): idempotency keys are agent-chosen strings, so they are
    // only unique WITHIN an org. A global index would let one org's key collide
    // with — and replay the result of — another's.
    const existing = await ctx.db
      .query("apiIdempotency")
      .withIndex("by_org_key", (q) =>
        q.eq("organizationId", organizationId).eq("key", key),
      )
      .first();

    if (existing) {
      // Same key, different call. Returning either result would be wrong (the
      // stored one answers a different question; running this one would double-
      // write under a key the caller believes is already spent), so refuse.
      if (existing.argsHash !== argsHash || existing.operation !== operation) {
        throw new ConvexError({
          code: "IDEMPOTENCY_KEY_REUSED",
          message:
            "This idempotency key was already used for a different call. Use a new key.",
          details: { key, operation: existing.operation },
        });
      }
      if (existing.status === "DONE") {
        return { status: "REPLAYED" as const, result: existing.result };
      }
      return { status: "IN_PROGRESS" as const };
    }

    await ctx.db.insert("apiIdempotency", {
      organizationId,
      apiKeyId,
      key,
      operation,
      argsHash,
      status: "PENDING",
      createdAt: now,
    });
    return { status: "CLAIMED" as const };
  },
});

export const complete = mutation({
  args: {
    organizationId: v.string(),
    key: v.string(),
    result: v.optional(v.any()),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { organizationId, key, result, now }) => {
    await requireService(ctx);
    const row = await ctx.db
      .query("apiIdempotency")
      .withIndex("by_org_key", (q) =>
        q.eq("organizationId", organizationId).eq("key", key),
      )
      .first();
    if (!row) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: `apiIdempotency claim not found: ${key}`,
      });
    }
    // Completing twice is benign (a duplicate step-3 after a retried dispatch);
    // keep the FIRST recorded result so replays stay stable.
    if (row.status === "DONE") return null;
    await ctx.db.patch(row._id, { status: "DONE", result, completedAt: now });
    return null;
  },
});

/**
 * Release a claim that never ran — the dispatcher's error path when the wrapped
 * operation threw *before* producing any effect. Without this, a rejected call
 * (bad args, missing scope) would burn its idempotency key into a permanent
 * PENDING row and every honest retry would get `IDEMPOTENT_IN_PROGRESS`.
 * Only ever deletes a PENDING row — a DONE result is never discarded.
 */
export const release = mutation({
  args: { organizationId: v.string(), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { organizationId, key }) => {
    await requireService(ctx);
    const row = await ctx.db
      .query("apiIdempotency")
      .withIndex("by_org_key", (q) =>
        q.eq("organizationId", organizationId).eq("key", key),
      )
      .first();
    if (row && row.status === "PENDING") await ctx.db.delete(row._id);
    return null;
  },
});

export const getByKey = query({
  args: { organizationId: v.string(), key: v.string() },
  handler: async (ctx, { organizationId, key }) => {
    await requireService(ctx);
    return await ctx.db
      .query("apiIdempotency")
      .withIndex("by_org_key", (q) =>
        q.eq("organizationId", organizationId).eq("key", key),
      )
      .first();
  },
});
