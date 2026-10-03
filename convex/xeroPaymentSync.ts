import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireService } from "./lib/auth";
import { collectCapped } from "./lib/pagination";
import { settleInvoicePaymentState } from "./paymentsWrites";

/**
 * Xero payment sync — the Convex side (follow-up automation phase 2,
 * FEATUREDOCS/82, design §8.5). The Xero client and token vault live in `src/`
 * (Convex can't import them), so the fetch runs in a Next route driven by the
 * notification cron (`src/server/xero-payment-sync.ts`); these SERVICE-only
 * functions are what it calls. No user or agent token reaches any of them.
 *
 * Xero owns reconciliation, so what's read back is invoice-level truth —
 * Status, AmountPaid, AmountCredited, AmountDue — never just Payments: voids,
 * credit-note allocations and overpayments made in Xero never appear as a
 * Payment. `paymentsWrites.recomputeInvoicePaymentState` folds it into
 * `paymentStatus`; `settleInvoicePaymentState` then runs the same
 * auto-status + follow-up reconcile a hand-recorded payment does.
 */

const MAX_INVOICES_PER_ORG = 500;
/** Settlement from the sync is attributed to this actor in the audit trail. */
const XERO_SYNC_ACTOR = { userId: "system", userName: "Xero sync" };

/** Flow invoices pushed to Xero that Flow doesn't yet know are settled. */
export const pushedUnsettledInvoices = query({
  args: { orgId: v.string() },
  returns: v.array(v.object({ id: v.string(), xeroInvoiceId: v.string() })),
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    const { rows } = await collectCapped(
      ctx.db.query("invoices").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "ISSUED")),
      MAX_INVOICES_PER_ORG,
    );
    return rows
      .filter((i) => i.xeroInvoiceId && i.kind !== "CREDIT" && i.paymentStatus !== "PAID")
      .map((i) => ({ id: i.id, xeroInvoiceId: i.xeroInvoiceId! }));
  },
});

const xeroInvoiceState = v.object({
  invoiceId: v.string(),
  xeroStatus: v.string(),
  amountPaid: v.number(),
  amountCredited: v.number(),
  amountDue: v.number(),
});

/** Apply what Xero reported for a batch of invoices. Org-checked per row
 *  (`by_cuid` is global). Idempotent: re-applying the same numbers recomputes
 *  to the same state. */
export const applyXeroInvoiceStates = mutation({
  args: { orgId: v.string(), states: v.array(xeroInvoiceState), now: v.number() },
  returns: v.object({ applied: v.number(), settled: v.number() }),
  handler: async (ctx, { orgId, states, now }) => {
    await requireService(ctx);
    if (states.length > MAX_INVOICES_PER_ORG) throw new ConvexError("Too many invoice states in one batch.");
    let applied = 0;
    let settled = 0;
    for (const s of states) {
      const invoice = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", s.invoiceId)).first();
      if (!invoice || invoice.organizationId !== orgId) continue;
      await ctx.db.patch(invoice._id, {
        xeroStatus: s.xeroStatus,
        xeroAmountPaid: s.amountPaid,
        xeroAmountCredited: s.amountCredited,
        xeroAmountDue: s.amountDue,
        xeroCheckedAt: now,
      });
      const fresh = (await ctx.db.get(invoice._id))!;
      await settleInvoicePaymentState(ctx, fresh, XERO_SYNC_ACTOR, now);
      applied++;
      if ((await ctx.db.get(invoice._id))?.paymentStatus === "PAID") settled++;
    }
    const integration = await ctx.db.query("xeroIntegrations").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).first();
    if (integration) await ctx.db.patch(integration._id, { paymentsSyncedAt: now });
    return { applied, settled };
  },
});

/**
 * The refresh-token lease. Xero rotates the refresh token on every use, so two
 * concurrent refreshes (a user's push and the sync, say) would each persist a
 * token the other has already spent. Every refresh first takes this lease;
 * Convex serialises the mutation, so exactly one holder wins.
 */
export const acquireTokenLease = mutation({
  args: { orgId: v.string(), holder: v.string(), now: v.number(), ttlMs: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { orgId, holder, now, ttlMs }) => {
    await requireService(ctx);
    const integration = await ctx.db.query("xeroIntegrations").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).first();
    if (!integration) return false;
    const held = integration.tokenLeaseHolder && integration.tokenLeaseHolder !== holder && (integration.tokenLeaseUntil ?? 0) > now;
    if (held) return false;
    await ctx.db.patch(integration._id, { tokenLeaseHolder: holder, tokenLeaseUntil: now + Math.min(ttlMs, 60_000) });
    return true;
  },
});

export const releaseTokenLease = mutation({
  args: { orgId: v.string(), holder: v.string() },
  returns: v.null(),
  handler: async (ctx, { orgId, holder }) => {
    await requireService(ctx);
    const integration = await ctx.db.query("xeroIntegrations").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).first();
    if (integration?.tokenLeaseHolder === holder) {
      await ctx.db.patch(integration._id, { tokenLeaseHolder: undefined, tokenLeaseUntil: undefined });
    }
    return null;
  },
});
