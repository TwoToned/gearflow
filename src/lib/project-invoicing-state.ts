/**
 * "Where is this project's invoicing up to, and what's the next step?" — the
 * single derivation behind BOTH the Finance tab's nudge chips and the Overview
 * tab's invoicing card (#1061).
 *
 * The next-step rule (deposit before balance, one full invoice otherwise)
 * already existed as inline JSX conditions in `project-finance-panel.tsx`.
 * Reading it a second time for the Overview card would have made two
 * hand-maintained copies of the same business rule — a defect even while in
 * sync (R-3.1) — so it moved here and both surfaces now read it.
 *
 * A plain module: no React, no Convex, so the rule is unit-testable.
 */

export type PaymentProfile = "FULL_UPFRONT" | "DEPOSIT_BALANCE" | string;

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
 * The one invoice the operator most likely wants to raise next. `NONE` carries
 * the reason so the UI can say why rather than showing a dead button.
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
  hasDeposit: boolean;
  hasBalance: boolean;
  hasFull: boolean;
  depositIssued: boolean;
  /** The most recently issued invoice, for the card's "last activity" line. */
  latestIssued: InvoiceLike | null;
  /**
   * The oldest ISSUED invoice still carrying a balance — the one a "Record
   * payment" action should target. Oldest first because that's the one that
   * has been outstanding longest, and a half-cent tolerance keeps float
   * rounding from resurrecting a settled invoice.
   */
  firstUnpaidIssued: InvoiceLike | null;
  nextStep: NextInvoiceStep;
  /** Headline state for the card's badge. */
  headline: "NOT_STARTED" | "DRAFT" | "AWAITING_PAYMENT" | "PARTIALLY_PAID" | "PAID_IN_FULL";
}

const isLive = (inv: InvoiceLike) => inv.status !== "VOID";
const isIssued = (inv: InvoiceLike) => inv.status === "ISSUED";

/**
 * Which invoice comes next, per the client's payment profile. Mirrors the
 * server's own model rather than inventing a gate: invoice creation is NOT
 * blocked on an accepted quote anywhere in `invoicesWrites.ts`, so this never
 * claims it is.
 */
function deriveNextStep(
  live: InvoiceLike[],
  paymentProfile: PaymentProfile,
  depositPercent: number,
): NextInvoiceStep {
  const hasDeposit = live.some((i) => i.kind === "DEPOSIT");
  const hasBalance = live.some((i) => i.kind === "BALANCE");
  const hasFull = live.some((i) => i.kind === "FULL");
  const depositIssued = live.some((i) => i.kind === "DEPOSIT" && i.status === "ISSUED");

  if (paymentProfile === "DEPOSIT_BALANCE") {
    if (!hasDeposit) return { kind: "DEPOSIT", label: "Create deposit invoice", depositPercent };
    // The balance is only meaningful once the deposit is real money owed —
    // netting a balance against an unissued draft would misstate it.
    if (depositIssued && !hasBalance) return { kind: "BALANCE", label: "Create balance invoice" };
    if (!depositIssued) return { kind: "NONE", reason: "Issue the deposit invoice first" };
    return { kind: "NONE", reason: "Deposit and balance both raised" };
  }

  if (!hasFull) return { kind: "FULL", label: "Create invoice" };
  return { kind: "NONE", reason: "Already invoiced" };
}

function deriveHeadline(
  live: InvoiceLike[],
  issued: InvoiceLike[],
  outstanding: number,
  notYetInvoiced: number | null,
): InvoicingState["headline"] {
  if (live.length === 0) return "NOT_STARTED";
  if (issued.length === 0) return "DRAFT";
  if (outstanding > 0) {
    return issued.some((i) => (i.amountPaid ?? 0) > 0) ? "PARTIALLY_PAID" : "AWAITING_PAYMENT";
  }
  // Everything issued is paid — but the job isn't fully invoiced until there's
  // nothing left to raise, so a paid deposit alone is not "paid in full".
  return notYetInvoiced != null && notYetInvoiced > 0.005 ? "AWAITING_PAYMENT" : "PAID_IN_FULL";
}

export function deriveInvoicingState(
  invoices: InvoiceLike[],
  paymentProfile: PaymentProfile,
  depositPercent: number,
  projectTotal: number | null,
): InvoicingState {
  const liveInvoices = invoices.filter(isLive);
  const issued = liveInvoices.filter(isIssued);

  const invoicedTotal = issued.reduce((sum, i) => sum + i.total, 0);
  const paidTotal = issued.reduce((sum, i) => sum + (i.amountPaid ?? 0), 0);
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
    hasDeposit: liveInvoices.some((i) => i.kind === "DEPOSIT"),
    hasBalance: liveInvoices.some((i) => i.kind === "BALANCE"),
    hasFull: liveInvoices.some((i) => i.kind === "FULL"),
    depositIssued: liveInvoices.some((i) => i.kind === "DEPOSIT" && i.status === "ISSUED"),
    latestIssued: issuedByDate[0] ?? null,
    firstUnpaidIssued:
      [...issued]
        .sort((a, b) => (a.issuedAt ?? 0) - (b.issuedAt ?? 0))
        .find((i) => i.total - (i.amountPaid ?? 0) > 0.005) ?? null,
    nextStep: deriveNextStep(liveInvoices, paymentProfile, depositPercent),
    headline: deriveHeadline(liveInvoices, issued, outstanding, notYetInvoiced),
  };
}

export const INVOICING_HEADLINE_LABEL: Record<InvoicingState["headline"], string> = {
  NOT_STARTED: "Not started",
  DRAFT: "Draft",
  AWAITING_PAYMENT: "Awaiting payment",
  PARTIALLY_PAID: "Partially paid",
  PAID_IN_FULL: "Paid in full",
};
