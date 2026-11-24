import type { Doc } from "../_generated/dataModel";

/**
 * When an invoice is overdue, and what is still owed on it (UX Phase 11, D88).
 * Pure: ONE predicate for every surface that says "overdue" about an invoice.
 * Home's Needs attention line and the More sheet's Finance count read it today;
 * the job Finance tab and the Finance hub are meant to (D56).
 *
 * Overdue = ISSUED, not settled (`paymentStatus !== "PAID"`, itself derived from
 * `payments` + the Xero read-back in `paymentsWrites.recomputeInvoicePaymentState`),
 * not a credit note, and its due DAY is over. `dueDate` is stamped as the start of
 * the due day in the org's timezone (`invoicesWrites` `startOfDayInTimezone`), so
 * the invoice is still on time for the whole of that day.
 *
 * The outstanding amount is DERIVED, never stored: `total` less what has been paid
 * (`amountPaid`, the derived sum of the invoice's non-voided payments, or Xero's
 * paid figure when larger) less any Xero credit allocated against it. It is never
 * negative.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type InvoiceMoney = Pick<Doc<"invoices">, "total" | "amountPaid" | "xeroAmountCredited">;
type InvoiceDue = Pick<Doc<"invoices">, "status" | "kind" | "paymentStatus" | "dueDate">;

function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** What is still owed on the invoice, in dollars (≥ 0). */
export function invoiceOutstanding(inv: InvoiceMoney): number {
  const owed = (Number(inv.total) || 0) - (inv.amountPaid ?? 0) - (inv.xeroAmountCredited ?? 0);
  return Math.max(0, cents(owed));
}

/** Is the invoice overdue at `now`? */
export function isInvoiceOverdue(inv: InvoiceDue, now: number): boolean {
  if (inv.status !== "ISSUED" || inv.kind === "CREDIT") return false;
  if ((inv.paymentStatus ?? "UNPAID") === "PAID") return false;
  return inv.dueDate != null && now >= inv.dueDate + DAY_MS;
}
