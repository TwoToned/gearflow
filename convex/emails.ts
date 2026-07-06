import { v, ConvexError } from "convex/values";
import { mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireService } from "./lib/auth";

/**
 * Phase 6b — Convex durable, idempotent email side-effects.
 *
 * A server action (or, in future, a native mutation) calls `enqueue` AFTER its
 * write commits. `enqueue` schedules `internal.emailActions.deliver` via
 * `ctx.scheduler.runAfter(0, …)`, so the email:
 *   - can't fire on a rolled-back write (the enqueue mutation itself commits
 *     only if the caller's transaction did),
 *   - runs off the request path (durable + observable in the Convex dashboard),
 *   - is deduped against retries by the `sentEmails` idempotency ledger.
 *
 * Idempotency contract (the risk the task flags — actions can retry):
 *   - `claim` does a transactional first-writer-wins insert on `idempotencyKey`.
 *     Only the claimant sends; concurrent runs of the same key skip.
 *   - if the send THROWS, the action calls `release` to delete the claim so a
 *     later attempt can re-send (avoids "marked sent but never sent").
 *   - a successful send keeps the claim, so any later re-delivery is skipped.
 * The caller chooses the key: use a natural nonce already tied to the write
 * (e.g. a crew-offer response token) so a legitimate user-initiated re-send
 * gets a fresh key (new email), while an action retry of the SAME send dedupes.
 *
 * Requires the SERVICE token — email enqueue must never be browser-callable
 * (spam vector). Actual delivery uses the Convex deployment's RESEND_API_KEY /
 * EMAIL_FROM (see convex/emailActions.ts); until those are set the action
 * mock-logs instead of sending.
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

    await ctx.scheduler.runAfter(0, internal.emailActions.deliver, args);
    return { scheduled: true, alreadySent: false };
  },
});

/**
 * Transactionally claim an idempotency key. Returns `{ claimed: true }` if this
 * call inserted the ledger row (the caller should send), `{ claimed: false }` if
 * the key was already present (skip — already sent or claimed by a concurrent
 * run). Internal — only the delivery action calls it.
 */
export const claim = internalMutation({
  args: {
    idempotencyKey: v.string(),
    to: v.string(),
    subject: v.string(),
    now: v.number(),
  },
  returns: v.object({ claimed: v.boolean() }),
  handler: async (ctx, { idempotencyKey, to, subject, now }) => {
    const existing = await ctx.db
      .query("sentEmails")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .first();
    if (existing) return { claimed: false };
    await ctx.db.insert("sentEmails", { idempotencyKey, to, subject, sentAt: now });
    return { claimed: true };
  },
});

/**
 * Release a previously-claimed key after a failed send so a later attempt can
 * re-send. No-op if the row is already gone.
 */
export const release = internalMutation({
  args: { idempotencyKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { idempotencyKey }) => {
    const existing = await ctx.db
      .query("sentEmails")
      .withIndex("by_idempotencyKey", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});
