import { sendEmail } from "@/lib/email";
import { nativeEmailSideEffects } from "@/lib/native-writes";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Deliver a transactional (post-write) email side-effect.
 *
 * When `NATIVE_EMAIL_SIDEEFFECTS` is on (Phase 6b), route the send through the
 * Convex durable + idempotent scheduler (`api.emails.enqueue` →
 * `internal.emailActions.deliver`): off the request path, retry-safe via the
 * idempotency key, and observable in the Convex dashboard. Otherwise send inline
 * via Resend exactly as before (default).
 *
 * Call this AFTER the triggering write has committed. `idempotencyKey` should
 * carry a nonce tied to THIS specific send (e.g. a per-offer response token) so
 * that a legitimate user-initiated re-send gets a fresh key (a new email) while
 * an action retry of the same scheduled send dedupes.
 */
export async function deliverSideEffectEmail(args: {
  idempotencyKey: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (nativeEmailSideEffects()) {
    const convex = await getConvexClient();
    await convex.mutation(api.emails.enqueue, {
      idempotencyKey: args.idempotencyKey,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    return;
  }
  // REMOVE-BY 2026-10-18 (R-4.5): legacy inline-send fork — delete once
  // NATIVE_EMAIL_SIDEEFFECTS is confirmed stable in prod (see native-writes.ts).
  await sendEmail({ to: args.to, subject: args.subject, html: args.html });
}
