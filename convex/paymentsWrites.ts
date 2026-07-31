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
async function recomputeInvoicePaymentState(ctx: MutationCtx, invoice: Doc<"invoices">, now: number): Promise<void> {
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
  returns: v.object({ id: v.string() }),
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

    await recomputeInvoicePaymentState(ctx, invoice, now);

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

    return { id };
  },
});

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
    await recomputeInvoicePaymentState(ctx, invoice, now);

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
  recordNative: { danger: "medium" },
  // Reduces a recorded payment, which can move an invoice back out of PAID —
  // financial, same tier as invoicesWrites.voidNative.
  voidNative: { danger: "high" },
};
