"use node";

import { v } from "convex/values";
import { Resend } from "resend";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Phase 6b — the Node-runtime delivery action for Convex-scheduled emails.
 *
 * Scheduled by `emails.enqueue` via `ctx.scheduler.runAfter(0, …)`. Runs in the
 * Convex Node runtime so it can do the external Resend I/O. Kept thin: all DB
 * work (the delivered-ledger read/write) goes back through `convex/emails.ts` so
 * it stays transactional.
 *
 * At-least-once with bounded retry: on a transient send failure the action
 * reschedules itself (up to MAX_ATTEMPTS, with backoff) instead of recording
 * delivery — so a dropped send is retried rather than lost. After the last
 * attempt it gives up (logged; visible in the dashboard). A delivered-ledger row
 * (written only on confirmed success) makes a later re-invocation of the same key
 * skip, so the retry chain can't double-send.
 *
 * Delivery uses the Convex DEPLOYMENT env (`RESEND_API_KEY` / `EMAIL_FROM`),
 * which is separate from the Next.js runtime env. Until those are set the action
 * mock-logs and records the ledger row (parity with the `src/lib/email.ts`
 * dev-mock, which "succeeds" without sending) — so wiring a send site through
 * here is inert until the deployment env is configured.
 */

const MAX_ATTEMPTS = 3;
// Backoff before attempt N+1 (index by current attempt: 1→60s, 2→300s).
const BACKOFF_MS = [60_000, 300_000];

export const deliver = internalAction({
  args: {
    idempotencyKey: v.string(),
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    attempt: v.number(),
  },
  returns: v.object({
    sent: v.optional(v.boolean()),
    mock: v.optional(v.boolean()),
    skipped: v.optional(v.boolean()),
    retrying: v.optional(v.boolean()),
    failed: v.optional(v.boolean()),
    attempt: v.optional(v.number()),
  }),
  handler: async (ctx, { idempotencyKey, to, subject, html, attempt }) => {
    // Dedupe: never re-deliver a key that already succeeded.
    const alreadySent = await ctx.runQuery(internal.emails.isSent, { idempotencyKey });
    if (alreadySent) {
      console.log(`[email] already delivered, skipping: ${idempotencyKey}`);
      return { skipped: true };
    }

    try {
      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.EMAIL_FROM ?? "GearFlow <noreply@gearflow.app>";
      if (!apiKey || apiKey === "re_xxxxxxxxxxxxxxxxxxxx") {
        // No key on the deployment — mock-log and RECORD delivery (matches the
        // dev-mock in src/lib/email.ts, which returns success without sending).
        console.log(`[email] no RESEND_API_KEY on deployment — mock send to ${to}: ${subject}`);
        await ctx.runMutation(internal.emails.markSent, {
          idempotencyKey,
          to,
          subject,
          now: Date.now(),
        });
        return { mock: true };
      }
      const resend = new Resend(apiKey);
      // Pass our key as Resend's Idempotency-Key so the PROVIDER dedupes a
      // duplicate send (a retry after a crash post-accept, or a rare concurrent
      // re-invocation) — closing the exactly-once gap the local ledger can't,
      // since the ledger is written only after the external call returns.
      const { error } = await resend.emails.send(
        { from, to, subject, html },
        { idempotencyKey },
      );
      if (error) throw new Error(`Resend failed: ${error.message}`);

      await ctx.runMutation(internal.emails.markSent, {
        idempotencyKey,
        to,
        subject,
        now: Date.now(),
      });
      return { sent: true };
    } catch (e) {
      // Transient failure — retry with backoff (no ledger row written, so the
      // retry re-sends rather than being deduped away).
      if (attempt < MAX_ATTEMPTS) {
        const delay = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
        console.warn(
          `[email] send failed for ${idempotencyKey} (attempt ${attempt}/${MAX_ATTEMPTS}); ` +
            `retrying in ${Math.round(delay / 1000)}s: ${(e as Error).message}`,
        );
        await ctx.scheduler.runAfter(delay, internal.emailActions.deliver, {
          idempotencyKey,
          to,
          subject,
          html,
          attempt: attempt + 1,
        });
        return { retrying: true, attempt: attempt + 1 };
      }
      // Exhausted — give up loudly (visible in the dashboard). No ledger row, so
      // a later user-initiated re-send (new key) still works.
      console.error(
        `[email] send permanently failed for ${idempotencyKey} after ${MAX_ATTEMPTS} attempts: ` +
          `${(e as Error).message}`,
      );
      return { failed: true, attempt };
    }
  },
});
