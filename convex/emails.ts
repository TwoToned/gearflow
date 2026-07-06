import { v, ConvexError } from "convex/values";
import { mutation, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireService } from "./lib/auth";

/**
 * Phase 6b — Convex durable, idempotent email side-effects.
 *
 * A server action (or, in future, a native mutation) calls `enqueue` AFTER its
 * write commits. `enqueue` schedules `internal.emailActions.deliver` via
 * `ctx.scheduler.runAfter(0, …)`, so the email:
 *   - can't fire on a rolled-back write (the enqueue mutation commits only if the
 *     caller's transaction did),
 *   - runs off the request path (durable + observable in the Convex dashboard),
 *   - is retried with backoff on transient failure (at-least-once), and
 *   - is deduped against re-delivery by the `sentEmails` ledger.
 *
 * Delivery model (delivered-ledger, not a pre-send claim):
 *   - A `sentEmails` row means DELIVERED. `deliver` re-checks it and skips if the
 *     key was already delivered, then sends, then records the row on success.
 *   - On a transient failure `deliver` reschedules itself (bounded attempts +
 *     backoff) instead of recording delivery — so a dropped send is retried
 *     rather than lost. After the last attempt it gives up (logged, visible in
 *     the dashboard); no row is written, so a later user-initiated re-send with a
 *     fresh key still works.
 *
 * Idempotency contract (the risk the task flags — retries must not double-send):
 *   The `idempotencyKey` MUST be unique per logical send — carry a nonce already
 *   tied to the write (e.g. a crew-offer response token, or a per-send nonce), so
 *   a user-initiated re-send uses a NEW key → a new email. Dedupe is two-layered:
 *   the delivered-ledger row skips re-delivery once a key has succeeded, and the
 *   same key is passed to Resend as its `Idempotency-Key` so the PROVIDER dedupes
 *   the narrow window the local ledger can't cover (a crash after Resend accepted
 *   but before the ledger write, or a rare concurrent re-invocation). Net: this is
 *   at-least-once locally, made effectively exactly-once at the provider boundary.
 *
 * Requires the SERVICE token — email enqueue must never be browser-callable
 * (spam vector). Actual delivery uses the Convex deployment's RESEND_API_KEY /
 * EMAIL_FROM (see convex/emailActions.ts); until those are set the action
 * mock-logs (and records the ledger row) instead of sending.
 */

export const enqueue = mutation({
  args: {
    idempotencyKey: v.string(),
    to: v.string(),
    subject: v.string(),
    html: v.string(),
  },
  returns: v.object({
    scheduled: v.boolean(),
    alreadySent: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireService(ctx);
    if (!args.to) throw new ConvexError("emails.enqueue: missing recipient");

    // Fast pre-check — if this key already delivered, don't even schedule.
    const existing = await ctx.db
      .query("sentEmails")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    if (existing) return { scheduled: false, alreadySent: true };

    await ctx.scheduler.runAfter(0, internal.emailActions.deliver, {
      ...args,
      attempt: 1,
    });
    return { scheduled: true, alreadySent: false };
  },
});

/** True iff this idempotency key has already been delivered. */
export const isSent = internalQuery({
  args: { idempotencyKey: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { idempotencyKey }) => {
    const row = await ctx.db
      .query("sentEmails")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .first();
    return row !== null;
  },
});

/**
 * Record a successful delivery. Idempotent — if a row already exists for the key
 * (a late duplicate), it's left untouched. Internal — only the delivery action
 * calls it, after a confirmed send.
 */
export const markSent = internalMutation({
  args: {
    idempotencyKey: v.string(),
    to: v.string(),
    subject: v.string(),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { idempotencyKey, to, subject, now }) => {
    const existing = await ctx.db
      .query("sentEmails")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .first();
    if (!existing) {
      await ctx.db.insert("sentEmails", { idempotencyKey, to, subject, sentAt: now });
    }
    return null;
  },
});
