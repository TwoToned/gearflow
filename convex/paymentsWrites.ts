import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertNumRange, assertStrLen } from "./lib/fieldGuards";
import { assertRefInOrg } from "./lib/orgRef";
import * as enums from "./lib/validators";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { maybeAutoAdvanceProjectStatus, autoAdvanceStatus, revertAutoAdvanceByTrigger } from "./lib/projectAutoStatus";

/**
 * Payment write mutations (#1055) — browser-direct, standard 4-guard shape,
 * `assertWritesEnabled`/`enforceBrowserWriteLimit` gated under the "invoice"
 * domain (payments are part of the invoice write surface, so the kill-switch
 * for invoice writes also stops payment recording).
 *
 * A payment is bookkeeping, not a client-facing document — there is no PDF, so
 * the "never delete a finance artifact" rule that gates invoice/quote deletion
 * doesn't apply here. It's still never hard-deleted, only voided (`voidNative`),
 * so the audit trail never loses a record of money that was recorded in error.
 * `invoicesWrites.ts deleteVoidNative` refuses to permanently delete a VOID
 * invoice while any of its payments are still non-voided, so a payment's
 * existence is never silently orphaned by that path either.
 *
 * `invoices.amountPaid`/`paymentStatus` are DERIVED — recomputed from this
 * invoice's own non-voided payments inside the same mutation that writes/voids
 * one, never hand-typed (R-9.3, same rule `recalcProjectTotals` follows for
 * project-level totals).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** Mirrors DATE_BOUNDS in invoicesWrites.ts / quotesWrites.ts (≤ 2100-01-01) —
 *  a typo'd year can't stamp a payment centuries out. */
const DATE_BOUNDS = { min: 0, max: 4_102_444_800_000 } as const;

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Recompute `amountPaid`/`paymentStatus` from this invoice's own non-voided
 *  payments and patch the invoice row — called from inside the same mutation
 *  that just wrote or voided a payment, so the two can never drift apart. */
async function recomputeInvoicePaymentState(ctx: MutationCtx, invoice: Doc<"invoices">, now: number): Promise<string> {
  // Bounded by invoiceId (R-9.8) — a single invoice never realistically carries
  // more than a handful of payments; 500 is a generous safety cap, not an
  // expected count.
  const payments = await ctx.db
    .query("payments")
    .withIndex("by_organizationId_invoiceId", (q) => q.eq("organizationId", invoice.organizationId).eq("invoiceId", invoice.id))
    .take(500);
  const amountPaid = round(payments.filter((p) => p.voidedAt == null).reduce((sum, p) => sum + p.amount, 0));
  const total = Number(invoice.total) || 0;
  const paymentStatus = amountPaid <= 0 ? "UNPAID" : amountPaid >= total ? "PAID" : "PARTIALLY_PAID";
  await ctx.db.patch(invoice._id, { amountPaid, paymentStatus, updatedAt: now });
  return paymentStatus;
}

/** The client-input subset of recordNative's args (mirrors paymentSchema in
 *  src/lib/validations/payment.ts — registered in validationDrift.test.ts).
 *  id/orgId/invoiceId are recordNative's own structural create-time args, not
 *  part of this pair. */
export const paymentFields = {
  amount: v.number(),
  method: enums.PaymentMethod,
  reference: v.optional(v.string()),
  paidAt: v.number(),
  notes: v.optional(v.string()),
};

export const recordNative = mutation({
  returns: v.object({ id: v.string(), autoStatus: v.union(v.string(), v.null()) }),
  args: {
    id: v.string(),
    orgId: v.string(),
    invoiceId: v.string(),
    amount: v.number(),
    method: enums.PaymentMethod,
    reference: v.optional(v.string()),
    paidAt: v.number(),
    notes: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, invoiceId, amount, method, reference, paidAt, notes, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "invoice");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "invoice", "record_payment");
    const actor = await resolveActor(ctx, suppliedActor);

    assertNumRange(amount, "amount", { min: 0.01 });
    assertNumRange(paidAt, "paidAt", DATE_BOUNDS);
    assertStrLen(reference, "reference", { max: 200 });
    assertStrLen(notes, "notes", { max: 2000 });

    await assertRefInOrg(ctx, "invoices", invoiceId, orgId);
    const invoice = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", invoiceId)).first();
    if (!invoice) throw new ConvexError("Invoice not found: " + invoiceId);
    if (invoice.status !== "ISSUED") {
      throw new ConvexError({ code: "INVALID_STATE", message: "Payments can only be recorded against an ISSUED invoice." });
    }

    const dup = await ctx.db.query("payments").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dup) throw new ConvexError("Payment already exists");

    await ctx.db.insert("payments", {
      id,
      organizationId: orgId,
      invoiceId,
      projectId: invoice.projectId,
      amount: round(amount),
      method,
      reference,
      paidAt,
      notes,
      recordedById: actor.userId,
      createdAt: now,
      updatedAt: now,
    });

    const paymentStatus = await recomputeInvoicePaymentState(ctx, invoice, now);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "CREATE",
      entityType: "payment",
      entityId: id,
      entityName: `Payment against ${invoice.invoiceNumber ?? invoiceId}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Recorded a $${round(amount).toFixed(2)} payment against invoice ${invoice.invoiceNumber ?? invoiceId}`,
      projectId: invoice.projectId,
      createdAt: now,
    });

    // #1236 — payment is the confirmation. Only a FULL settlement counts: a
    // partial payment leaves the job exactly where it was. The rule itself
    // re-checks the accepted-quote gate the manual confirm enforces and takes
    // the same snapshot, so this is not a way around either.
    // A CREDIT note is excluded: its `total` is NEGATIVE (`createCreditNative`
    // stores `-original.total`), so ANY positive amount recorded against it
    // satisfies `amountPaid >= total` and reads as PAID. Money moving on a
    // credit is a refund going OUT, never the client's payment coming in.
    const autoStatus =
      paymentStatus === "PAID" && invoice.kind !== "CREDIT"
        ? autoAdvanceStatus(
            await maybeAutoAdvanceProjectStatus(ctx, {
              orgId, projectId: invoice.projectId, trigger: "PAYMENT_SETTLED", actor, now,
            }),
          )
        : null;

    return { id, autoStatus };
  },
});

/** Is any non-CREDIT invoice on this project still settled in full? A second
 *  paid invoice is its own reason for the job to be confirmed, so voiding a
 *  payment against one of them must not walk the status back. */
async function anyInvoiceSettled(ctx: MutationCtx, orgId: string, projectId: string): Promise<boolean> {
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", orgId).eq("projectId", projectId))
    .take(200);
  return invoices.some((i) => i.kind !== "CREDIT" && i.status !== "VOID" && i.paymentStatus === "PAID");
}

export const voidNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    reason: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, reason, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "invoice");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "invoice", "void_payment");
    const actor = await resolveActor(ctx, suppliedActor);
    assertStrLen(reason, "reason", { min: 1, max: 1000 });

    const payment = await ctx.db.query("payments").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!payment) throw new ConvexError("Payment not found: " + id);
    if (payment.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");
    if (payment.voidedAt != null) {
      throw new ConvexError({ code: "INVALID_STATE", message: "Payment is already voided." });
    }

    const invoice = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", payment.invoiceId)).first();
    if (!invoice) throw new ConvexError("Invoice not found: " + payment.invoiceId);

    await ctx.db.patch(payment._id, { voidedAt: now, voidedById: actor.userId, voidReason: reason, updatedAt: now });
    const paymentStatus = await recomputeInvoicePaymentState(ctx, invoice, now);

    // #1236 — voiding the payment that settled the job has to walk the status
    // back out of CONFIRMED too. Without this a mis-keyed payment confirms a job
    // permanently: the void unwinds the money, but `PAYMENT_SETTLED`'s `from` set
    // no longer matches, so re-recording it correctly can never re-advance.
    //
    // Only when NOTHING else on the project is settled — another fully-paid
    // invoice is its own reason for the job to be confirmed — and only when the
    // automation's move is still the project's most recent status change
    // (`revertAutoAdvanceByTrigger` refuses otherwise, so a later manual decision
    // is never stamped over). The caller holds `invoice:void_payment`; the tier
    // drop this causes (CONFIRMED FINANCE_LOCKED → AWAITING_PAYMENT OPEN) re-opens
    // money fields to someone who by definition may already edit the money.
    if (paymentStatus !== "PAID" && !(await anyInvoiceSettled(ctx, orgId, invoice.projectId))) {
      await revertAutoAdvanceByTrigger(ctx, {
        orgId, projectId: invoice.projectId, trigger: "PAYMENT_SETTLED", actor, now,
      });
    }

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "payment",
      entityId: id,
      entityName: `Payment against ${invoice.invoiceNumber ?? invoice.id}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Voided a $${round(payment.amount).toFixed(2)} payment against invoice ${invoice.invoiceNumber ?? invoice.id}: ${reason}`,
      projectId: invoice.projectId,
      createdAt: now,
    });

    return { id };
  },
});

/** Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9). */
export const agentOps: AgentOpsAnnotations = {
  // Real money-record creation, but reversible via voidNative — same tier as
  // invoicesWrites.createNative.
  // `high`, not `medium` (#1236): recording a payment that settles an invoice in
  // full now advances the project to CONFIRMED — raising the lock tier, taking a
  // whole-project snapshot and auto-committing any open unlock session. The two
  // sibling triggers that reach the same money phase (`markAcceptedNative`,
  // `issueNative`) are both `high`, and a narrowly-scoped agent should not move a
  // job's lifecycle without the dispatcher's confirmation gate.
  recordNative: { danger: "high" },
  // Reduces a recorded payment, which can move an invoice back out of PAID —
  // financial, same tier as invoicesWrites.voidNative.
  voidNative: { danger: "high" },
};
