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
 * work (the idempotency claim/release) goes back through mutations in
 * `convex/emails.ts` so it stays transactional.
 *
 * Delivery uses the Convex DEPLOYMENT env (`RESEND_API_KEY` / `EMAIL_FROM`),
 * which is separate from the Next.js runtime env. Until those are set on the
 * deployment the action mock-logs and keeps the claim (parity with the
 * `src/lib/email.ts` dev-mock, which "succeeds" without sending) — so wiring a
 * send site through here is inert until the deployment env is configured.
 */
export const deliver = internalAction({
  args: {
    idempotencyKey: v.string(),
    to: v.string(),
    subject: v.string(),
    html: v.string(),
  },
  returns: v.object({
    sent: v.optional(v.boolean()),
    mock: v.optional(v.boolean()),
    skipped: v.optional(v.boolean()),
  }),
  handler: async (ctx, { idempotencyKey, to, subject, html }) => {
    // Claim first — first-writer-wins guards concurrent retries from double-send.
    const { claimed } = await ctx.runMutation(internal.emails.claim, {
      idempotencyKey,
      to,
      subject,
      now: Date.now(),
    });
    if (!claimed) {
      console.log(`[email] already sent/claimed, skipping: ${idempotencyKey}`);
      return { skipped: true };
    }

    try {
      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.EMAIL_FROM ?? "GearFlow <noreply@gearflow.app>";
      if (!apiKey || apiKey === "re_xxxxxxxxxxxxxxxxxxxx") {
        // No key on the deployment — mock-log and KEEP the claim (matches the
        // dev-mock in src/lib/email.ts, which returns success without sending).
        console.log(`[email] no RESEND_API_KEY on deployment — mock send to ${to}: ${subject}`);
        return { mock: true };
      }
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({ from, to, subject, html });
      if (error) throw new Error(`Resend failed: ${error.message}`);
      return { sent: true };
    } catch (e) {
      // Release the claim so a later attempt can retry this send.
      await ctx.runMutation(internal.emails.release, { idempotencyKey });
      throw e;
    }
  },
});
