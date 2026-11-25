/**
 * "Where is this project's invoicing up to, and what can be raised next?" —
 * the single derivation behind BOTH the Finance tab's invoice menu and the
 * Overview tab's invoicing card (#1061).
 *
 * Invoicing used to be forced into one rigid sequence per client
 * (`paymentProfile`): FULL_UPFRONT clients got exactly one full invoice,
 * DEPOSIT_BALANCE clients got a deposit THEN a balance, in that order, with
 * nothing else offered. That's gone — every project can raise a "partial
 * balance" invoice (any % or $ slice of what's left) any number of times, and
 * a "remaining balance" invoice for whatever's left, in any order, as long as
 * there's something left to invoice. `paymentProfile`/`profileDepositPercent`
 * now only supply the % a partial invoice defaults to — they no longer gate
 * what's offered.
 *
 * A plain module: no React, no Convex, so the rule is unit-testable.
 */

import { isInvoiceOverdue } from "../../convex/lib/invoiceOverdue";

/** The default % a partial invoice offers when the client has no `profileDepositPercent`. */
const DEFAULT_DEPOSIT_PERCENT = 25;

/** The ONE read of a client's deposit default (R-3.1): every caller of `deriveInvoicingState` uses it. */
export function clientDepositPercent(client: { profileDepositPercent?: unknown } | null | undefined): number {
  const p = client?.profileDepositPercent;
  return typeof p === "number" ? p : DEFAULT_DEPOSIT_PERCENT;
}

export interface InvoiceLike {
  id: string;
  kind: string;
  status: string;
  paymentStatus?: string | null;
  invoiceNumber?: string | null;
  total: number;
  amountPaid?: number | null;
  issuedAt?: number | null;
  dueDate?: number | null;
}

/**
 * A single invoice action the operator can take right now. `NONE` carries the
 * reason so the UI can say why rather than showing a dead button.
 */
export type NextInvoiceStep =
  | { kind: "DEPOSIT"; label: string; depositPercent: number }
  | { kind: "BALANCE"; label: string }
  | { kind: "FULL"; label: string }
  | { kind: "NONE"; reason: string };

export interface InvoicingState {
  /** Every invoice that still counts — VOID rows are excluded throughout. */
  liveInvoices: InvoiceLike[];
  /** Σ totals of ISSUED invoices. Drafts are not money owed yet. */
  invoicedTotal: number;
  /** Σ recorded payments against ISSUED invoices. */
  paidTotal: number;
  /** Issued but not yet paid. */
  outstanding: number;
  /** Project value not yet on any invoice — `null` when the total is unknown. */
  notYetInvoiced: number | null;
  /** The most recently issued invoice, for the card's "last activity" line. */
  latestIssued: InvoiceLike | null;
  /**
   * The oldest ISSUED invoice still carrying a balance — the one a "Record
   * payment" action should target. Oldest first because that's the one that
   * has been outstanding longest, and a half-cent tolerance keeps float
   * rounding from resurrecting a settled invoice.
   */
  firstUnpaidIssued: InvoiceLike | null;
  /**
   * Raise a slice of what's left (kind DEPOSIT) — a % or $ amount the
   * operator chooses, offered any time there's a remainder. Not capped at
   * one: a project can carry several partial invoices before the remaining
   * balance is raised.
   */
  partialStep: NextInvoiceStep;
  /**
   * Raise an invoice for whatever's left (server-computed, no operator
   * input). `FULL` (itemized line-by-line) when nothing has been invoiced
   * yet — the common one-shot case; `BALANCE` (a single summary line) once
   * at least one invoice already exists, since the equipment/service
   * breakdown was already shown on the earlier one(s).
   */
  remainingStep: NextInvoiceStep;
  /** ISSUED invoices that are not credit notes (a refund is never "an invoice sent"). */
  issuedInvoices: InvoiceLike[];
  /** Σ ISSUED credit-note totals (negative); already folded into `invoicedTotal`. */
  creditedTotal: number;
  /**
   * Every issued invoice is settled (or credits cancel what is owed) and at
   * least one invoice is out. The `PAYMENT_SETTLED` condition as a human reads it.
   */
  allSettled: boolean;
  /** Issued invoices past their due day. Empty when `now` was not supplied. */
  overdueInvoices: InvoiceLike[];
  /** Headline state for the card's badge. */
  headline:
    | "NOT_STARTED"
    | "DRAFT"
    | "AWAITING_PAYMENT"
    | "OVERDUE"
    | "PARTIALLY_PAID"
    | "DEPOSIT_PAID"
    | "PAID_IN_FULL";
}

const isLive = (inv: InvoiceLike) => inv.status !== "VOID";
const isIssued = (inv: InvoiceLike) => inv.status === "ISSUED";

/** A slice of what's left, sized however the operator likes — available any
 *  time there's a remainder, regardless of how many partials already exist. */
function derivePartialStep(notYetInvoiced: number | null, depositPercent: number): NextInvoiceStep {
  if (notYetInvoiced == null) return { kind: "NONE", reason: "Job total not set" };
  if (notYetInvoiced <= 0.005) return { kind: "NONE", reason: "Fully invoiced" };
  return { kind: "DEPOSIT", label: "Partial balance", depositPercent };
}

/** Whatever's left, in one shot — FULL (itemized) the first time, BALANCE
 *  (summary line) after that. */
function deriveRemainingStep(notYetInvoiced: number | null, hasAnyInvoice: boolean): NextInvoiceStep {
  if (notYetInvoiced == null) return { kind: "NONE", reason: "Job total not set" };
  if (notYetInvoiced <= 0.005) return { kind: "NONE", reason: "Fully invoiced" };
  return hasAnyInvoice
    ? { kind: "BALANCE", label: "Remaining balance" }
    : { kind: "FULL", label: "Remaining balance" };
}

function deriveHeadline(
  live: InvoiceLike[],
  issued: InvoiceLike[],
  facts: { outstanding: number; notYetInvoiced: number | null; overdueCount: number },
): InvoicingState["headline"] {
  const { outstanding, notYetInvoiced, overdueCount } = facts;
  if (live.length === 0) return "NOT_STARTED";
  if (issued.length === 0) return "DRAFT";
  if (outstanding > 0) {
    // D56: Overdue outranks Part paid.
    if (overdueCount > 0) return "OVERDUE";
    return issued.some((i) => (i.amountPaid ?? 0) > 0) ? "PARTIALLY_PAID" : "AWAITING_PAYMENT";
  }
  // Everything issued is paid — but the job isn't fully invoiced until there's
  // nothing left to raise, so a paid partial alone is not "paid in full".
  if (notYetInvoiced != null && notYetInvoiced > 0.005) {
    return issued.some((i) => i.kind === "DEPOSIT") ? "DEPOSIT_PAID" : "AWAITING_PAYMENT";
  }
  return "PAID_IN_FULL";
}

export function deriveInvoicingState(
  invoices: InvoiceLike[],
  depositPercent: number,
  projectTotal: number | null,
  /** Clock for the overdue test; omitted = nothing is reported overdue. */
  now?: number,
): InvoicingState {
  const liveInvoices = invoices.filter(isLive);
  const issuedAll = liveInvoices.filter(isIssued);
  const issued = issuedAll.filter((i) => i.kind !== "CREDIT");
  const creditedTotal = issuedAll.filter((i) => i.kind === "CREDIT").reduce((sum, i) => sum + i.total, 0);

  const invoicedTotal = issued.reduce((sum, i) => sum + i.total, 0) + creditedTotal;
  const paidTotal = issued.reduce((sum, i) => sum + (i.amountPaid ?? 0), 0);
  const overdueInvoices = now == null ? [] : issued.filter((i) => isInvoiceOverdue(i, now));
  // Never negative: an overpayment is allowed server-side (recordNative doesn't
  // cap it), and "-$50 outstanding" would read as a debt rather than a credit.
  const outstanding = Math.max(0, invoicedTotal - paidTotal);
  const notYetInvoiced =
    projectTotal == null ? null : Math.max(0, projectTotal - liveInvoices.reduce((sum, i) => sum + i.total, 0));

  const issuedByDate = [...issued].sort((a, b) => (b.issuedAt ?? 0) - (a.issuedAt ?? 0));

  return {
    liveInvoices,
    invoicedTotal,
    paidTotal,
    outstanding,
    notYetInvoiced,
    latestIssued: issuedByDate[0] ?? null,
    firstUnpaidIssued:
      [...issued]
        .sort((a, b) => (a.issuedAt ?? 0) - (b.issuedAt ?? 0))
        .find((i) => i.total - (i.amountPaid ?? 0) > 0.005) ?? null,
    partialStep: derivePartialStep(notYetInvoiced, depositPercent),
    remainingStep: deriveRemainingStep(notYetInvoiced, liveInvoices.length > 0),
    issuedInvoices: issued,
    creditedTotal,
    allSettled: issued.length > 0 && (issued.every((i) => i.paymentStatus === "PAID") || outstanding <= 0.005),
    overdueInvoices,
    headline: deriveHeadline(liveInvoices, issued, { outstanding, notYetInvoiced, overdueCount: overdueInvoices.length }),
  };
}

export const INVOICING_HEADLINE_LABEL: Record<InvoicingState["headline"], string> = {
  NOT_STARTED: "Not started",
  DRAFT: "Draft",
  AWAITING_PAYMENT: "Awaiting payment",
  OVERDUE: "Overdue",
  PARTIALLY_PAID: "Partially paid",
  DEPOSIT_PAID: "Deposit paid",
  PAID_IN_FULL: "Paid in full",
};
