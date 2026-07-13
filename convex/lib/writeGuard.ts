import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/**
 * Emergency brake for the browser-direct mutation surface (Phase 3 kill-switch).
 *
 * Every browser-direct (public) mutation must call this FIRST. When the
 * `systemFlags` singleton has `writesDisabled` (or lists the mutation's `domain`
 * in `disabledDomains`), it throws — so an abusive/runaway client can be cut off
 * INSTANTLY via `systemFlags.setWrites`, with no redeploy. Server-routed
 * (service-token) writes are the trusted backend and are NOT gated here; they have
 * their own env-flag controls.
 *
 * The read is one indexed-free `first()` on a single-row table (negligible), and
 * it joins the mutation's transaction read-set — so flipping the flag deterministically
 * takes effect on the next write.
 */
export async function assertWritesEnabled(ctx: MutationCtx, domain?: string): Promise<void> {
  const flags = await ctx.db.query("systemFlags").first();
  if (!flags) return; // no row → writes enabled (default)
  if (flags.writesDisabled) {
    throw new ConvexError(
      "Writes are temporarily disabled" +
        (flags.disabledReason ? `: ${flags.disabledReason}` : "."),
    );
  }
  if (domain && flags.disabledDomains?.includes(domain)) {
    throw new ConvexError(
      `Writes for "${domain}" are temporarily disabled` +
        (flags.disabledReason ? `: ${flags.disabledReason}` : "."),
    );
  }
}
